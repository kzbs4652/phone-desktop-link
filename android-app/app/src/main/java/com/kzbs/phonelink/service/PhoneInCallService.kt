package com.kzbs.phonelink.service

import android.net.Uri
import android.media.Ringtone
import android.media.RingtoneManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.OutcomeReceiver
import android.telecom.Call
import android.telecom.CallAudioState
import android.telecom.CallEndpoint
import android.telecom.InCallService
import android.telecom.TelecomManager
import android.util.Log
import com.google.gson.JsonObject
import org.json.JSONObject

/** Telecom bridge used when the user enables PhoneLink's call controls. */
class PhoneInCallService : InCallService() {
    companion object {
        const val ACTION_CALL_STATE = "com.kzbs.phonelink.CALL_STATE"

        @Volatile var instance: PhoneInCallService? = null
            private set
        @Volatile var currentCall: Call? = null
            private set
        @Volatile var currentMuted: Boolean = false
            private set
        @Volatile var currentRoute: String = "PHONE"
            private set
        @Volatile var availableRoutes: List<String> = emptyList()
            private set

        private val mainHandler = Handler(Looper.getMainLooper())
        private var pendingToneStop: Runnable? = null

        fun handlePcCommand(action: String, payload: JsonObject): Boolean {
            val service = instance ?: return false
            val call = currentCall
            return try {
                when (action) {
                    "END_CALL" -> {
                        if (call == null) false else { call.disconnect(); true }
                    }
                    "DTMF_TONE" -> {
                        val digit = payload.get("digit")?.asString?.firstOrNull()
                        if (call == null || digit == null || digit !in '0'..'9' && digit != '*' && digit != '#') false
                        else {
                            pendingToneStop?.let(mainHandler::removeCallbacks)
                            call.stopDtmfTone()
                            call.playDtmfTone(digit!!)
                            val toneCall = call
                            pendingToneStop = Runnable {
                                try { toneCall.stopDtmfTone() } catch (_: Exception) {}
                                pendingToneStop = null
                            }.also { mainHandler.postDelayed(it, 180) }
                            true
                        }
                    }
                    "CALL_MUTE" -> {
                        service.setMuted(payload.get("muted")?.asBoolean ?: false)
                        true
                    }
                    "CALL_ROUTE" -> service.routeCall(payload.get("route")?.asString ?: "PHONE")
                    "CALL_HOLD" -> if (call == null) false else { call.hold(); true }
                    "CALL_UNHOLD" -> if (call == null) false else { call.unhold(); true }
                    "ADD_CALL", "DIAL_CALL" -> service.placePhoneCall(payload.get("number")?.asString.orEmpty())
                    else -> false
                }
            } catch (error: Exception) {
                Log.w("PhoneInCallService", "$action başarısız: ${error.message}")
                false
            }
        }

        fun publishEnded(context: PhoneInCallService) {
            val payload = JSONObject().put("status", "ENDED").put("timestamp", System.currentTimeMillis())
            val event = JSONObject().put("action", "CALL_STATE_CHANGED").put("payload", payload)
            PhoneLinkService.instance?.sendToPc(event.toString())
            context.sendBroadcast(android.content.Intent(ACTION_CALL_STATE).setPackage(context.packageName))
        }
    }

    private val callbacks = mutableMapOf<Call, Call.Callback>()
    private var endpointCache: List<CallEndpoint> = emptyList()
    private var ringtone: Ringtone? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
    }

    override fun onCallAdded(call: Call) {
        super.onCallAdded(call)
        instance = this
        currentCall = call
        val callback = object : Call.Callback() {
            override fun onStateChanged(call: Call, state: Int) {
                if (state == Call.STATE_RINGING) startRingtone() else stopRingtone()
                publishCall(call)
            }
            override fun onDetailsChanged(call: Call, details: Call.Details) = publishCall(call)
            override fun onConferenceableCallsChanged(call: Call, conferenceableCalls: MutableList<Call>) = publishCall(call)
        }
        callbacks[call] = callback
        call.registerCallback(callback)
        if (call.details.state == Call.STATE_RINGING) startRingtone()
        publishCall(call)

        // This is the user's in-call UI when PhoneLink is selected as the dialer.
        try {
            startActivity(android.content.Intent(this, com.kzbs.phonelink.InCallActivity::class.java).apply {
                addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK or android.content.Intent.FLAG_ACTIVITY_SINGLE_TOP)
            })
        } catch (error: Exception) {
            Log.w("PhoneInCallService", "Arama ekranı açılamadı: ${error.message}")
        }
    }

    override fun onCallRemoved(call: Call) {
        stopRingtone()
        callbacks.remove(call)?.let(call::unregisterCallback)
        if (currentCall === call) {
            currentCall = getCalls().lastOrNull { it !== call && it.details.state != Call.STATE_DISCONNECTED }
        }
        if (currentCall == null) publishEnded(this) else publishCall(currentCall!!)
        super.onCallRemoved(call)
    }

    override fun onAvailableCallEndpointsChanged(endpoints: MutableList<CallEndpoint>) {
        super.onAvailableCallEndpointsChanged(endpoints)
        endpointCache = endpoints.toList()
        availableRoutes = endpoints.map(::endpointName)
        currentCall?.let(::publishCall)
    }

    override fun onCallEndpointChanged(callEndpoint: CallEndpoint) {
        super.onCallEndpointChanged(callEndpoint)
        currentRoute = endpointName(callEndpoint)
        currentCall?.let(::publishCall)
    }

    override fun onCallAudioStateChanged(audioState: CallAudioState) {
        super.onCallAudioStateChanged(audioState)
        currentMuted = audioState.isMuted
        currentRoute = legacyRouteName(audioState.route)
        currentCall?.let(::publishCall)
    }

    override fun onMuteStateChanged(isMuted: Boolean) {
        super.onMuteStateChanged(isMuted)
        currentMuted = isMuted
        currentCall?.let(::publishCall)
    }

    private fun placePhoneCall(number: String): Boolean {
        if (number.isBlank()) return false
        val telecom = getSystemService(TELECOM_SERVICE) as TelecomManager
        telecom.placeCall(Uri.fromParts("tel", number, null), Bundle())
        return true
    }

    private fun startRingtone() {
        if (ringtone?.isPlaying == true) return
        try {
            val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
            ringtone = RingtoneManager.getRingtone(this, uri)?.also { it.play() }
        } catch (error: Exception) {
            Log.w("PhoneInCallService", "Zil sesi başlatılamadı: ${error.message}")
        }
    }

    private fun stopRingtone() {
        try { ringtone?.stop() } catch (_: Exception) {}
        ringtone = null
    }

    private fun routeCall(requestedRoute: String): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            val targetType = if (requestedRoute.equals("BLUETOOTH", true)) CallEndpoint.TYPE_BLUETOOTH else CallEndpoint.TYPE_EARPIECE
            val endpoint = endpointCache.firstOrNull { it.endpointType == targetType } ?: return false
            requestCallEndpointChange(endpoint, mainExecutor, object : OutcomeReceiver<Void, android.telecom.CallEndpointException> {
                override fun onResult(result: Void?) { currentRoute = endpointName(endpoint); currentCall?.let(::publishCall) }
                override fun onError(error: android.telecom.CallEndpointException) {
                    Log.w("PhoneInCallService", "Ses yönü değiştirilemedi: ${error.message}")
                }
            })
            return true
        }
        val wanted = if (requestedRoute.equals("BLUETOOTH", true)) CallAudioState.ROUTE_BLUETOOTH else CallAudioState.ROUTE_EARPIECE
        val state = callAudioState ?: return false
        if (state.supportedRouteMask and wanted == 0) return false
        setAudioRoute(wanted)
        return true
    }

    private fun publishCall(call: Call) {
        val state = call.details.state
        if (state == Call.STATE_DISCONNECTED || state == Call.STATE_DISCONNECTING) return
        val number = try { call.details.handle?.schemeSpecificPart.orEmpty() } catch (_: Exception) { "" }
        val payload = JSONObject()
            .put("status", stateName(state))
            .put("number", number)
            .put("timestamp", System.currentTimeMillis())
            .put("isMuted", currentMuted)
            .put("audioRoute", currentRoute)
            .put("availableRoutes", org.json.JSONArray(availableRoutes))
            .put("canAddCall", canAddCall())
        val event = JSONObject().put("action", "CALL_STATE_CHANGED").put("payload", payload)
        PhoneLinkService.instance?.sendToPc(event.toString())
        sendBroadcast(android.content.Intent(ACTION_CALL_STATE).setPackage(packageName))
    }

    private fun endpointName(endpoint: CallEndpoint): String = when (endpoint.endpointType) {
        CallEndpoint.TYPE_BLUETOOTH -> "BLUETOOTH"
        CallEndpoint.TYPE_SPEAKER -> "SPEAKER"
        CallEndpoint.TYPE_WIRED_HEADSET -> "WIRED_HEADSET"
        else -> "PHONE"
    }

    private fun legacyRouteName(route: Int): String = when {
        route and CallAudioState.ROUTE_BLUETOOTH != 0 -> "BLUETOOTH"
        route and CallAudioState.ROUTE_SPEAKER != 0 -> "SPEAKER"
        route and CallAudioState.ROUTE_WIRED_HEADSET != 0 -> "WIRED_HEADSET"
        else -> "PHONE"
    }

    private fun stateName(state: Int): String = when (state) {
        Call.STATE_RINGING -> "RINGING"
        Call.STATE_DIALING -> "DIALING"
        Call.STATE_CONNECTING -> "CONNECTING"
        Call.STATE_ACTIVE -> "ACTIVE"
        Call.STATE_HOLDING -> "HOLDING"
        Call.STATE_DISCONNECTING -> "DISCONNECTING"
        Call.STATE_SELECT_PHONE_ACCOUNT -> "SELECT_PHONE_ACCOUNT"
        else -> "NEW"
    }
}
