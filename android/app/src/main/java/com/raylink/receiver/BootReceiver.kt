package com.raylink.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.raylink.service.ConnectionService

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
            ConnectionService.start(context)
        }
    }
}
