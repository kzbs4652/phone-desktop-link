package com.kzbs.phonelink.receiver;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.telephony.TelephonyManager;
import com.kzbs.phonelink.service.PhoneLinkService;
import org.json.JSONObject;

public class CallStateReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (TelephonyManager.ACTION_PHONE_STATE_CHANGED.equals(intent.getAction())) {
            String stateStr = intent.getStringExtra(TelephonyManager.EXTRA_STATE);
            String number = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER);

            String status = "IDLE";
            if (TelephonyManager.EXTRA_STATE_RINGING.equals(stateStr)) {
                status = "RINGING";
            } else if (TelephonyManager.EXTRA_STATE_OFFHOOK.equals(stateStr)) {
                status = "ACTIVE";
            } else if (TelephonyManager.EXTRA_STATE_IDLE.equals(stateStr)) {
                status = "ENDED";
            }

            try {
                JSONObject payload = new JSONObject();
                payload.put("status", status);
                payload.put("number", number != null ? number : "Bilinmeyen Numara");
                payload.put("timestamp", System.currentTimeMillis());

                if (PhoneLinkService.instance != null) {
                    PhoneLinkService.instance.sendEventToPc("CALL_STATE_CHANGED", payload);
                }
            } catch (Exception ignored) {}
        }
    }
}
