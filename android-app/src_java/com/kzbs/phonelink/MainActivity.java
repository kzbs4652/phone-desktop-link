package com.kzbs.phonelink;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import com.kzbs.phonelink.service.PhoneLinkService;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;

public class MainActivity extends Activity {
    private TextView tvStatus;
    private TextView tvLog;
    private LinearLayout layoutUpdateBanner;
    private TextView tvUpdateBannerText;
    private Button btnDownloadUpdate;
    private String latestApkUrl = "https://github.com/kzbs4652/phone-desktop-link/raw/main/dist/KZBS-PhoneLink-v1.0.0.apk";

    private static final int CURRENT_VERSION_CODE = 1;

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
        layoutUpdateBanner = findViewById(R.id.layoutUpdateBanner);
        tvUpdateBannerText = findViewById(R.id.tvUpdateBannerText);
        btnDownloadUpdate = findViewById(R.id.btnDownloadUpdate);

        Button btnPerm = findViewById(R.id.btnPermissions);
        Button btnToggle = findViewById(R.id.btnToggleService);
        Button btnCheckUpdates = findViewById(R.id.btnCheckUpdates);

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

        btnCheckUpdates.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                checkForUpdates(true);
            }
        });

        btnDownloadUpdate.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                try {
                    Intent browserIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(latestApkUrl));
                    startActivity(browserIntent);
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "Tarayici acilamadi: " + e.getMessage(), Toast.LENGTH_SHORT).show();
                }
            }
        });

        requestAppPermissions();
        startBridgeService();
        checkForUpdates(false);
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

    private void checkForUpdates(final boolean showToastIfUpToDate) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    URL url = new URL("https://raw.githubusercontent.com/kzbs4652/phone-desktop-link/main/version.json");
                    HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                    conn.setConnectTimeout(5000);
                    conn.setReadTimeout(5000);
                    conn.setRequestMethod("GET");

                    if (conn.getResponseCode() == 200) {
                        BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()));
                        StringBuilder sb = new StringBuilder();
                        String line;
                        while ((line = reader.readLine()) != null) {
                            sb.append(line);
                        }
                        reader.close();

                        JSONObject json = new JSONObject(sb.toString());
                        final int remoteVerCode = json.optInt("versionCode", 1);
                        final String remoteVerName = json.optString("version", "1.0.0");
                        JSONObject androidObj = json.optJSONObject("android");
                        if (androidObj != null) {
                            latestApkUrl = androidObj.optString("url", latestApkUrl);
                        }

                        runOnUiThread(new Runnable() {
                            @Override
                            public void run() {
                                if (remoteVerCode > CURRENT_VERSION_CODE) {
                                    layoutUpdateBanner.setVisibility(View.VISIBLE);
                                    tvUpdateBannerText.setText("🚀 Yeni Sürüm Yayında: v" + remoteVerName);
                                    appendLog("🌟 Yeni güncelleme bulundu: v" + remoteVerName);
                                } else {
                                    if (showToastIfUpToDate) {
                                        Toast.makeText(MainActivity.this, "✅ Yazılımınız güncel! (v1.0.0)", Toast.LENGTH_SHORT).show();
                                    }
                                    appendLog("✅ Sistem güncel: v1.0.0");
                                }
                            }
                        });
                    }
                    conn.disconnect();
                } catch (Exception e) {
                    if (showToastIfUpToDate) {
                        runOnUiThread(new Runnable() {
                            @Override
                            public void run() {
                                Toast.makeText(MainActivity.this, "Güncelleme kontrolü başarısız.", Toast.LENGTH_SHORT).show();
                            }
                        });
                    }
                }
            }
        }).start();
    }

    public void appendLog(String msg) {
        if (tvLog != null) {
            String current = tvLog.getText().toString();
            tvLog.setText(msg + "\n" + current);
        }
    }
}
