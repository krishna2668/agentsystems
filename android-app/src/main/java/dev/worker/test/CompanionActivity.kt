package dev.worker.test

import android.content.Intent
import android.os.Bundle
import android.os.Build
import android.widget.MediaController
import android.widget.VideoView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.compose.BackHandler
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/** Companion UI. The existing Worker execution and enrollment stay independent. */
class CompanionActivity : ComponentActivity() {
    private val refresh = mutableIntStateOf(0)
    private val previewRequest = mutableStateOf<Pair<Int,String>?>(null)
    private var linkSequence = 0
    private fun route(intent: Intent?) {
        if (intent?.action != Intent.ACTION_VIEW) return
        PreviewLink.job(intent.dataString, MainActivity.gatewayOrigin())?.let {
            previewRequest.value = Pair(++linkSequence, it)
        }
    }
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        route(intent)
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (savedInstanceState == null) route(intent)
        enableEdgeToEdge()
        setContent {
            val dark = isSystemInDarkTheme()
            val colors = if (Build.VERSION.SDK_INT >= 31) {
                if (dark) dynamicDarkColorScheme(this) else dynamicLightColorScheme(this)
            } else if (dark) darkColorScheme() else lightColorScheme()
            MaterialTheme(colorScheme = colors) { Companion(refresh.intValue, previewRequest.value) }
        }
    }
    override fun onResume() {
        super.onResume()
        refresh.intValue++
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Companion(refresh: Int, previewRequest: Pair<Int,String>?) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val library = remember { ArtifactLibrary(context.filesDir.toPath()) }
    val prefs = remember { context.getSharedPreferences("worker_v04", 0) }
    var destination by rememberSaveable { mutableIntStateOf(0) }
    var selected by rememberSaveable { mutableStateOf<String?>(null) }
    var jobs by remember { mutableStateOf<List<String>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf(false) }
    val connected = prefs.contains("id")
    // Refresh the data, not the screen. Existing results stay visible during refresh.
    LaunchedEffect(lifecycle, refresh, destination, selected) {
        if (selected != null || destination == 2) return@LaunchedEffect
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                val result = withContext(Dispatchers.IO) { runCatching { library.jobs() } }
                coroutineContext.ensureActive()
                result.onSuccess { jobs = it }
                error = result.isFailure
                loading = false
                delay(2000)
            }
        }
    }
    LaunchedEffect(previewRequest) { if (previewRequest != null) selected = previewRequest.second }
    BackHandler(selected != null) { selected = null }
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(if (selected != null) "Animation" else when (destination) {
                    1 -> "Library"; 2 -> "Worker"; else -> "AgentSystems"
                }) },
                navigationIcon = { if (selected != null) IconButton(onClick = { selected = null }) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back")
                } }
            )
        },
        bottomBar = {
            if (selected == null) NavigationBar {
                listOf("Home", "Library", "Worker").forEachIndexed { i, title ->
                    NavigationBarItem(
                        selected = destination == i,
                        onClick = { destination = i },
                        icon = { Icon(listOf(Icons.Default.Home, Icons.AutoMirrored.Filled.List, Icons.Default.Settings)[i], null) },
                        label = { Text(title) }
                    )
                }
            }
        }
    ) { padding ->
        val id = selected
        if (id != null && ArtifactLibrary.validId(id)) {
            var file by remember(id) { mutableStateOf<File?>(null) }
            var failure by remember(id) { mutableStateOf<String?>(null) }
            var attempt by remember(id) { mutableIntStateOf(0) }
            LaunchedEffect(id, attempt) {
                failure = null
                val result = withContext(Dispatchers.IO) {
                    runCatching {
                        val local = library.file(id).toFile()
                        if (local.isFile) local
                        else {
                            val base = prefs.getString("base", "") ?: ""
                            val device = prefs.getString("id", "") ?: ""
                            if (!ArtifactLibrary.validId(device) || base != MainActivity.gatewayOrigin())
                                throw IllegalStateException("Connect this Worker first")
                            ArtifactDownload.fetch(id, object : ArtifactDownload.Remote {
                                override fun manifest(job: String): ArtifactDownload.Manifest {
                                    val r = org.json.JSONObject(MainActivity.post(base, "/worker/artifacts/$job", null, device))
                                    return ArtifactDownload.Manifest(r.getString("job_id"), r.getString("sha256"), r.getInt("bytes"), r.getInt("chunks"))
                                }
                                override fun chunk(job: String, seq: Int): ArtifactDownload.Chunk {
                                    val r = org.json.JSONObject(MainActivity.post(base, "/worker/artifacts/$job/$seq", null, device))
                                    return ArtifactDownload.Chunk(r.getString("sha256"), r.getInt("seq"), r.getInt("chunks"), java.util.Base64.getDecoder().decode(r.getString("bytes_b64")))
                                }
                            }, library).toFile()
                        }
                    }
                }
                coroutineContext.ensureActive()
                result.onSuccess { file = it }
                result.onFailure {
                    failure = when (it) {
                        is MainActivity.HttpFailure -> when (it.code) {
                            401, 403 -> "This Worker is not authorized to retrieve this animation."
                            404 -> "This animation is not available to this Worker."
                            else -> "Could not retrieve animation. Try again."
                        }
                        is IllegalStateException -> "Connect this Worker first."
                        else -> "Could not verify the animation. Try again."
                    }
                }
            }
            Column(Modifier.fillMaxSize().padding(padding).padding(16.dp)) {
                val playable = file
                if (playable != null) {
                    key(id) { NativePreview(playable, Modifier.weight(1f).fillMaxWidth()) }
                    Spacer(Modifier.height(16.dp))
                    Text("Animation", style = MaterialTheme.typography.titleLarge)
                    Text("Stored on this device", style = MaterialTheme.typography.bodyMedium)
                } else if (failure != null) {
                    Text(failure!!)
                    TextButton(onClick = { attempt++ }) { Text("Try again") }
                } else {
                    LinearProgressIndicator(Modifier.fillMaxWidth())
                    Text("Preparing animation…")
                }
            }
        } else if (destination == 2) {
            Column(Modifier.padding(padding).padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Text(if (connected) "Your Worker" else "Connect a Worker", style = MaterialTheme.typography.headlineSmall)
                Text(if (connected) "Manage this device’s availability for authorized work." else "Connect this device to receive work from AgentSystems.")
                Button(onClick = { context.startActivity(Intent(context, MainActivity::class.java)) }) {
                    Text(if (connected) "Worker controls" else "Connect")
                }
            }
        } else {
            LazyColumn(
                Modifier.fillMaxSize().padding(padding),
                contentPadding = PaddingValues(20.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                if (destination == 0) {
                    item {
                        Text("Your work", style = MaterialTheme.typography.headlineMedium)
                        Text("Recent animations", style = MaterialTheme.typography.titleMedium)
                    }
                }
                if (loading) item { LinearProgressIndicator(Modifier.fillMaxWidth()) }
                if (error) item { Text("Could not refresh your library.") }
                else if (!loading && jobs.isEmpty()) item {
                    Text("No saved animations yet.", style = MaterialTheme.typography.bodyLarge)
                    Text("Completed videos will appear here automatically.")
                }
                items(if (destination == 0) jobs.take(5) else jobs, key = { it }) { job ->
                    OutlinedCard(onClick = { selected = job }, modifier = Modifier.fillMaxWidth()) {
                        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Default.PlayArrow, null, Modifier.size(36.dp))
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text("Animation", style = MaterialTheme.typography.titleMedium)
                                Text("Available offline", style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                }
                if (destination == 0) item {
                    TextButton(onClick = { destination = 1 }) { Text("View library") }
                }
            }
        }
    }
}

@Composable
private fun NativePreview(file: File, modifier: Modifier) {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var video by remember { mutableStateOf<VideoView?>(null) }
    var failed by remember { mutableStateOf(false) }
    var resumePosition by rememberSaveable(file.name) { mutableIntStateOf(0) }
    var resumePlaying by rememberSaveable(file.name) { mutableStateOf(true) }
    var prepared by remember { mutableStateOf(false) }
    DisposableEffect(lifecycle, video) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_PAUSE) video?.let {
                if (prepared) {
                    resumePosition = it.currentPosition
                    resumePlaying = it.isPlaying
                    it.pause()
                }
            } else if (event == Lifecycle.Event.ON_RESUME && prepared && resumePlaying) {
                video?.start()
            }
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    if (failed) Box(modifier, contentAlignment = Alignment.Center) {
        Text("This animation could not be played.")
    } else AndroidView(
        factory = { context ->
            VideoView(context).apply {
                val controls = MediaController(context)
                controls.setAnchorView(this)
                setMediaController(controls)
                setOnErrorListener { _, _, _ -> failed = true; true }
                setOnPreparedListener {
                    prepared = true
                    if (resumePosition > 0) seekTo(resumePosition)
                    if (resumePlaying && lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) start()
                }
                setVideoPath(file.absolutePath)
                video = this
            }
        },
        modifier = modifier,
        onRelease = { it.stopPlayback(); if (video === it) { video = null; prepared = false } },
        update = {}
    )
}
