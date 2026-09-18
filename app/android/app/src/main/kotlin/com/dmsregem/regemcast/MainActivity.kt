package com.dmsregem.regemcast

import io.flutter.embedding.android.FlutterFragmentActivity

// FlutterFragmentActivity, e não FlutterActivity: a tela de biometria do
// Android (usada pelo local_auth) só abre sobre uma FragmentActivity.
class MainActivity : FlutterFragmentActivity()
