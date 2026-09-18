package com.dmsregem.regemcast

import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import android.os.Bundle
import io.flutter.embedding.android.FlutterFragmentActivity

// FlutterFragmentActivity, e não FlutterActivity: a tela de biometria do
// Android (usada pelo local_auth) só abre sobre uma FragmentActivity.
class MainActivity : FlutterFragmentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        criarCanalDeAvisos()
    }

    // O servidor manda todo push no canal "avisos". Criado aqui, na primeira
    // abertura, ele aparece com nome e descrição em português nas configurações
    // de notificação do Android — e a pessoa pode silenciar só ele.
    private fun criarCanalDeAvisos() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val canal = NotificationChannel(
            "avisos",
            "Avisos do Regemcast",
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = "Campanha concluída ou pausada, modelo aprovado ou recusado, pagamento recusado."
        }
        getSystemService(NotificationManager::class.java)?.createNotificationChannel(canal)
    }
}
