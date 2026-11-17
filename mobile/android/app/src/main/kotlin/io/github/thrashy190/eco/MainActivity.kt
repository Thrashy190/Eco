package io.github.thrashy190.eco

import com.ryanheise.audioservice.AudioServiceActivity

// audio_service needs the activity to share Flutter's engine with the media service, so music outlives the screen.
class MainActivity : AudioServiceActivity()
