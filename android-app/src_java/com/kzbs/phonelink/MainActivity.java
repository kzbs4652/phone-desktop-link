package com.kzbs.phonelink;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.TextView;
import android.widget.Toast;
import com.kzbs.phonelink.service.PhoneLinkService;

public class MainActivity extends Activity {
    private TextView tvStatus;
    private TextView tvLog;

    private static final String[] PERMISSIONS = {
        "android.permission.RECEIVE_SMS",
        "android.permission.READ_SMS",
        "android.permission.SEND_SMS",
        "android.permission.CALL_PHONE",
        "android.permission.READ_PHONE_STATE",
        "android.permission.READ_CALL_LOG",
        "android.permission.READ_CONTACTS"
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        tvStatus = findViewById(R.id.tvConnectionStatus);
        tvLog = findViewById(R.id.tvLogStream);

        Button btnPerm = findViewById(R.id.btnPermissions);
        Button btnToggle = findViewById(R.id.btnToggleService);

        btnPerm.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                requestAppPermissions();
            }
        });

        btnToggle.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                stopService(new Intent(MainActivity.this, PhoneLinkService.class));
                tvStatus.setText("🔴 Kopru Duraklatildi");
                appendLog("Servis durduruldu.");
            }
        });

        requestAppPermissions();
        startBridgeService();
    }

    private void requestAppPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            requestPermissions(PERMISSIONS, 101);
        }
    }

    private void startBridgeService() {
        Intent intent = new Intent(this, PhoneLinkService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent);
        } else {
            startService(intent);
        }
        tvStatus.setText("🟢 Arka Plan Servisi Aktif (PC Aranıyor...)");
        appendLog("KZBS PhoneLink Servisi baslatildi.");
    }

    public void appendLog(String msg) {
        if (tvLog != null) {
            String current = tvLog.getText().toString();
            tvLog.setText(msg + "\n" + current);
        }
    }
}
