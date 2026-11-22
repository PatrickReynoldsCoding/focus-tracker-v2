import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Release signing key, kept outside the repo (same default as the owner's other apps).
// Without one the release APK is built unsigned.
val signingProps = Properties().apply {
    val f = file(System.getenv("FT_SIGNING") ?: "${System.getProperty("user.home")}/.android-keys/mpe-instruments.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "com.patrickreynolds.focustracker"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.patrickreynolds.focustracker"
        minSdk = 30
        targetSdk = 35
        // -Pft.versionCode / -Pft.versionName: build an older-numbered copy to test in-app updates.
        versionCode = (findProperty("ft.versionCode") as String?)?.toInt() ?: 9
        versionName = (findProperty("ft.versionName") as String?) ?: "0.4.0"
    }
    signingConfigs {
        if (signingProps.isNotEmpty()) create("release") {
            storeFile = file(signingProps.getProperty("storeFile"))
            storePassword = signingProps.getProperty("storePassword")
            keyAlias = signingProps.getProperty("keyAlias")
            keyPassword = signingProps.getProperty("keyPassword")
        }
    }
    buildTypes {
        release {
            signingConfig = signingConfigs.findByName("release")
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    testOptions { unitTests.isReturnDefaultValues = true }
    // Lint in AGP 8.7 cannot run on Java 25 (the JDK here); release builds skip the lint check.
    lint { checkReleaseBuilds = false }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.core:core-remoteviews:1.1.0")
    implementation("androidx.work:work-runtime-ktx:2.9.1")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
