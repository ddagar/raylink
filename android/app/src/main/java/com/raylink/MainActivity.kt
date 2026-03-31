package com.raylink

import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.raylink.service.ConnectionService
import kotlinx.coroutines.delay

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        setContent {
            MaterialTheme {
                HomeScreen(
                    onStartService = { ConnectionService.start(this) },
                    onStopService = { ConnectionService.stop(this) },
                    onOpenAccessibility = {
                        startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
                    }
                )
            }
        }
    }
}

@Composable
fun HomeScreen(
    onStartService: () -> Unit,
    onStopService: () -> Unit,
    onOpenAccessibility: () -> Unit
) {
    var serviceRunning by remember { mutableStateOf(ConnectionService.instance != null) }
    var connectedDevice by remember { mutableStateOf(ConnectionService.connectedDeviceName) }
    var isPaired by remember { mutableStateOf(ConnectionService.isPairedStatus) }

    // Poll connection state every second
    LaunchedEffect(Unit) {
        while (true) {
            serviceRunning = ConnectionService.instance != null
            connectedDevice = ConnectionService.connectedDeviceName
            isPaired = ConnectionService.isPairedStatus
            delay(1000)
        }
    }

    val statusText = when {
        !serviceRunning -> null
        isPaired && connectedDevice != null -> "Connected to $connectedDevice"
        serviceRunning -> "Searching for Mac on local network..."
        else -> null
    }

    val statusColor = when {
        isPaired -> MaterialTheme.colorScheme.primary
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Spacer(modifier = Modifier.height(48.dp))

            Text(
                text = "Android Link",
                style = MaterialTheme.typography.headlineLarge,
                fontWeight = FontWeight.Bold
            )

            Text(
                text = "Connect your Android phone to your Mac",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            Spacer(modifier = Modifier.height(32.dp))

            // Setup steps
            Card(
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Text(
                        text = "Setup",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold
                    )

                    Text("1. Start the daemon on your Mac")
                    Text("2. Make sure both devices are on the same WiFi")
                    Text("3. Enable the Accessibility Service for clipboard sync")
                    Text("4. Start the connection service below")
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            // Accessibility service button
            OutlinedButton(
                onClick = onOpenAccessibility,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("Enable Accessibility Service")
            }

            // Start/Stop service button
            Button(
                onClick = {
                    if (serviceRunning) {
                        onStopService()
                    } else {
                        onStartService()
                    }
                },
                modifier = Modifier.fillMaxWidth(),
                colors = if (serviceRunning) {
                    ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)
                } else {
                    ButtonDefaults.buttonColors()
                }
            ) {
                Text(if (serviceRunning) "Stop Connection" else "Start Connection")
            }

            if (statusText != null) {
                Text(
                    text = statusText,
                    style = MaterialTheme.typography.bodyMedium,
                    color = statusColor
                )
            }
        }
    }
}
