/**
 * Web MIDI: if a real MIDI keyboard is plugged in, it just works.
 * Listens to every input (including ones plugged in later) for
 * note-on / note-off and the sustain pedal (control change 64).
 */

export interface MidiHandlers {
  onPress: (midi: number, velocity: number) => void;
  onRelease: (midi: number) => void;
  onSustain: (down: boolean) => void;
  onDevicesChanged?: (names: string[]) => void;
}

export async function connectMidi(handlers: MidiHandlers): Promise<void> {
  // Not every browser has Web MIDI (e.g. Safari). That's fine: everything else still works.
  if (!('requestMIDIAccess' in navigator)) return;
  let access: MIDIAccess;
  try {
    access = await navigator.requestMIDIAccess();
  } catch {
    return; // permission denied or unavailable — stay quiet, it's optional
  }

  const onMessage = (event: MIDIMessageEvent) => {
    const data = event.data;
    if (!data || data.length < 2) return;
    const [status, d1, d2 = 0] = data;
    const type = status & 0xf0;
    if (type === 0x90 && d2 > 0) handlers.onPress(d1, d2 / 127);
    else if (type === 0x80 || (type === 0x90 && d2 === 0)) handlers.onRelease(d1);
    else if (type === 0xb0 && d1 === 64) handlers.onSustain(d2 >= 64);
  };

  const attachAll = () => {
    const names: string[] = [];
    access.inputs.forEach((input) => {
      input.onmidimessage = onMessage;
      names.push(input.name ?? 'MIDI keyboard');
    });
    handlers.onDevicesChanged?.(names);
  };

  attachAll();
  access.onstatechange = attachAll; // hot-plugging
}
