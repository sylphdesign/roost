// mic-watch: prints "1" when any app uses a microphone (for example a Zoom, Meet or Teams call), "0" when none does.
// Prints once at start, then only on change. Roost uses it to stay quiet during calls.
#include <CoreAudio/CoreAudio.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

static int mic_in_use(void) {
  AudioObjectPropertyAddress addr = { kAudioHardwarePropertyDevices, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain };
  UInt32 size = 0;
  if (AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &addr, 0, NULL, &size) != noErr || size == 0) return 0;
  AudioDeviceID *ids = malloc(size);
  if (!ids) return 0;
  int used = 0;
  if (AudioObjectGetPropertyData(kAudioObjectSystemObject, &addr, 0, NULL, &size, ids) == noErr) {
    UInt32 n = size / sizeof(AudioDeviceID);
    for (UInt32 i = 0; i < n && !used; i++) {
      AudioObjectPropertyAddress in = { kAudioDevicePropertyStreams, kAudioObjectPropertyScopeInput, kAudioObjectPropertyElementMain };
      UInt32 s = 0;
      if (AudioObjectGetPropertyDataSize(ids[i], &in, 0, NULL, &s) != noErr || s == 0) continue; // not an input device
      AudioObjectPropertyAddress run = { kAudioDevicePropertyDeviceIsRunningSomewhere, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain };
      UInt32 v = 0, vs = sizeof(v);
      if (AudioObjectGetPropertyData(ids[i], &run, 0, NULL, &vs, &v) == noErr && v) used = 1;
    }
  }
  free(ids);
  return used;
}

int main(int argc, char **argv) {
  int once = argc > 1 && argv[1][0] == '-' && argv[1][1] == '1';
  int last = -1;
  setvbuf(stdout, NULL, _IOLBF, 0);
  for (;;) {
    int now = mic_in_use();
    if (now != last) { printf("%d\n", now); last = now; }
    if (once) return 0;
    if (getppid() == 1) return 0; // Roost quit
    sleep(2);
  }
}
