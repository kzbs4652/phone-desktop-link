package com.kzbs.phonelink.service;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;
import com.kzbs.phonelink.MainActivity;
import org.json.JSONObject;
import java.io.OutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.URL;

public class PhoneLinkService extends Service {
    public static PhoneLinkService instance;
    private static final String CHANNEL_ID = "kzbs_phonelink_channel";
    private String pcIp = null;
    private boolean isRunning = true;

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        createNotificationChannel();
        startForeground(4955, buildNotification("Bilgisayar araniyor..."));
        startDiscoveryThread();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel chan = new NotificationChannel(
                CHANNEL_ID,
                "KZBS PhoneLink Servisi",
                NotificationManager.IMPORTANCE_LOW
            );
            NotificationManager mgr = getSystemService(NotificationManager.class);
            if (mgr != null) mgr.createNotificationChannel(chan);
        }
    }

    private Notification buildNotification(String text) {
        Intent intent = new Intent(this, MainActivity.class);
        PendingIntent pi = PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE);

        Notification.Builder builder;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            builder = new Notification.Builder(this, CHANNEL_ID);
        } else {
            builder = new Notification.Builder(this);
        }

        return builder.setContentTitle("KZBS PhoneLink v1.0.0")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentIntent(pi)
            .setOngoing(true)
            .build();
    }

    private void startDiscoveryThread() {
        new Thread(new Runnable() {
            @Override
            public void run() {
                while (isRunning && pcIp == null) {
                    try {
                        DatagramSocket socket = new DatagramSocket();
                        socket.setBroadcast(true);
                        byte[] ping = "KZBS_DISCOVERY_PING".getBytes();
                        DatagramPacket packet = new DatagramPacket(
                            ping, ping.length,
                            InetAddress.getByName("255.255.255.255"), 4956
                        );
                        socket.send(packet);

                        socket.setSoTimeout(3000);
                        byte[] buf = new byte[1024];
                        DatagramPacket recv = new DatagramPacket(buf, buf.length);
                        socket.receive(recv);

                        String resp = new String(recv.getData(), 0, recv.getLength());
                        if (resp.contains("KZBS PhoneLink")) {
                            pcIp = recv.getAddress().getHostAddress();
                            updateNotification("🟢 Bilgisayara Baglandi (" + pcIp + ")");
                            socket.close();
                            break;
                        }
                        socket.close();
                    } catch (Exception e) {
                        try { Thread.sleep(3000); } catch (InterruptedException ignored) {}
                    }
                }
            }
        }).start();
    }

    public void updateNotification(String text) {
        NotificationManager mgr = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (mgr != null) mgr.notify(4955, buildNotification(text));
    }

    public void sendEventToPc(final String action, final JSONObject payload) {
        if (pcIp == null) return;
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    URL url = new URL("http://" + pcIp + ":4955/api/phone/event");
                    HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                    conn.setRequestMethod("POST");
                    conn.setRequestProperty("Content-Type", "application/json");
                    conn.setDoOutput(true);

                    JSONObject root = new JSONObject();
                    root.put("action", action);
                    root.put("payload", payload);

                    OutputStream os = conn.getOutputStream();
                    os.write(root.toString().getBytes("UTF-8"));
                    os.close();
                    conn.getResponseCode();
                    conn.disconnect();
                } catch (Exception e) {
                    Log.e("KZBS", "Gonderim hatasi: " + e.getMessage());
                }
            }
        }).start();
    }

    public void dialNumber(String number) {
        try {
            Intent intent = new Intent(Intent.ACTION_CALL);
            intent.setData(Uri.parse("tel:" + Uri.encode(number)));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        } catch (Exception e) {
            Log.e("KZBS", "Arama hatasi: " + e.getMessage());
        }
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        isRunning = false;
        instance = null;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
