import java.io.FileInputStream
import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Chave de upload da Play Store. Mora FORA do repositório (android/key.properties
// aponta para o .jks) e nunca é commitada. Sem o arquivo — no CI, ou numa
// máquina nova — o build de release assina com a chave de depuração: serve para
// conferir que compila, e a Play recusa esse APK, então não há como publicar
// com a chave errada por engano.
val propriedadesDaChave = Properties()
val arquivoDaChave = rootProject.file("key.properties")
val temChaveDeUpload = arquivoDaChave.exists()
if (temChaveDeUpload) {
    FileInputStream(arquivoDaChave).use { propriedadesDaChave.load(it) }
}

android {
    namespace = "com.dmsregem.regemcast"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // Identificador na Play Store. NÃO muda depois da primeira publicação:
        // outro id é outro app, sem as avaliações nem os usuários deste.
        applicationId = "com.dmsregem.regemcast"
        // Android 7.0+. Biometria e cofre do sistema (Keystore) exigem.
        minSdk = 24
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (temChaveDeUpload) {
            create("upload") {
                keyAlias = propriedadesDaChave["keyAlias"] as String
                keyPassword = propriedadesDaChave["keyPassword"] as String
                storeFile = file(propriedadesDaChave["storeFile"] as String)
                storePassword = propriedadesDaChave["storePassword"] as String
            }
        }
    }

    buildTypes {
        release {
            signingConfig = if (temChaveDeUpload) {
                signingConfigs.getByName("upload")
            } else {
                signingConfigs.getByName("debug")
            }
            // Encolhe e ofusca o código de produção: APK menor e mais difícil
            // de desmontar. O Flutter já traz as regras que os plugins precisam.
            isMinifyEnabled = true
            isShrinkResources = true
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
