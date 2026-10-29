plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val releaseManifest = groovy.json.JsonSlurper().parse(rootProject.file("../version.json")) as Map<*, *>
val appVersion = releaseManifest["version"] as String
val appVersionCode = (releaseManifest["versionCode"] as Number).toInt()

android {
    namespace = "com.kzbs.phonelink"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.kzbs.phonelink"
        minSdk = 24
        targetSdk = 34
        versionCode = appVersionCode
        versionName = appVersion

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        create("phoneLinkRelease") {
            storeFile = rootProject.file("build_temp/debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("phoneLinkRelease")
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }

    kotlinOptions {
        jvmTarget = "1.8"
    }

    buildFeatures {
        viewBinding = true
        buildConfig = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("com.google.android.material:material:1.11.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")
    implementation("androidx.lifecycle:lifecycle-service:2.7.0")

    // WebSocket & HTTP Networking
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    // JSON Serialization
    implementation("com.google.code.gson:gson:2.10.1")
    // Coroutines
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
}
