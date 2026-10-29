package com.kzbs.phonelink.receiver;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.provider.Telephony;
import android.telephony.SmsMessage;
import com.kzbs.phonelink.service.PhoneLinkService;
import org.json.JSONObject;

public class SmsReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction())) {
            SmsMessage[] messages = Telephony.Sms.Intents.getMessagesFromIntent(intent);
            if (messages != null) {
                for (SmsMessage sms : messages) {
                    try {
                        String sender = sms.getDisplayOriginatingAddress();
                        String body = sms.getDisplayMessageBody();

                        JSONObject payload = new JSONObject();
                        payload.put("sender", sender != null ? sender : "Bilinmeyen");
                        payload.put("phone", sender);
                        payload.put("text", body);
                        payload.put("timestamp", System.currentTimeMillis());

                        if (PhoneLinkService.instance != null) {
                            PhoneLinkService.instance.sendEventToPc("SMS_RECEIVED", payload);
                        }
                    } catch (Exception ignored) {}
                }
            }
        }
    }
}
