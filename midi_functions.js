// --- MIDI Functions ---
function initMidi() {
    if (navigator.requestMIDIAccess) navigator.requestMIDIAccess({ sysex: true }).then(onMIDISuccess, onMIDIFailure);
    else console.warn("Web MIDI API is not supported in this browser.");
}

function onMIDISuccess(access) {
    midiAccess = access;
    midiInSelect.innerHTML = '<option value="">Select Input</option>';
    midiAccess.inputs.forEach(input => midiInSelect.innerHTML += `<option value="${input.id}">${input.name}</option>`);
    midiInSelect.disabled = false;
    midiOutSelect.innerHTML = '<option value="">Select Output</option>';
    midiAccess.outputs.forEach(output => midiOutSelect.innerHTML += `<option value="${output.id}">${output.name}</option>`);
    midiOutSelect.disabled = false;
}

function onMIDIFailure(msg) { console.error(`Failed to get MIDI access - ${msg}`); }

function setMidiInput(e) {
    if (activeMidiInput) activeMidiInput.removeEventListener('midimessage', onMidiMessage);
    activeMidiInput = midiAccess.inputs.get(e.target.value);
    if (activeMidiInput) activeMidiInput.addEventListener('midimessage', onMidiMessage);
}

function setMidiOutput(e) { activeMidiOutput = midiAccess.outputs.get(e.target.value); }

function onMidiMessage(event) {
    const command = event.data[0] >> 4, note = event.data[1], velocity = event.data[2] || 0;
    
    const currentBeatPosition = playheadPosition / (PIXELS_PER_BEAT * horizontalZoom);
    if (command === 9 && velocity > 0 && currentBeatPosition >= START_BEAT) {
        circleCounter++;
        let relativeX = currentBeatPosition;
        if(isBeatSnapOn) relativeX = Math.round(relativeX * BEAT_SNAP_SUBDIVISION) / BEAT_SNAP_SUBDIVISION;

        const initialLengthInBeats = parseFloat(initialNoteLengthSelect.value);
        const playLength = (initialLengthInBeats * 60) / tempo;

        circles.push({
            id: circleCounter, relativeX: relativeX,
            frequency: midiNoteToFrequency(note), playLength: playLength, velocity: velocity,
            playedThisCycle: false, colliding: false,
        });
        draw();
    }
}

function playNoteOnMidiOutput(frequency, playLength, velocity) {
    if (!activeMidiOutput) return;
    const midiNote = frequencyToMidiNote(frequency);
    activeMidiOutput.send([0x90, midiNote, velocity]);
    setTimeout(() => activeMidiOutput.send([0x80, midiNote, 0]), playLength * 1000);
}

/**
 * Exports a series of notes (circles) to a standard MIDI file without external libraries.
 * This version manually constructs the MIDI file byte by byte.
 * @param {Array} circlesToExport - An array of circle objects to be converted to MIDI notes.
 * @param {number} currentTempo - The tempo of the sequence in beats per minute (BPM).
 */
function exportToMidiFile(circlesToExport, currentTempo) {
    // Helper functions for writing binary data
    const writeStringToBytes = (str) => Array.from(str).map(c => c.charCodeAt(0));
    const write32 = (n) => [(n >> 24) & 0xFF, (n >> 16) & 0xFF, (n >> 8) & 0xFF, n & 0xFF];
    const write16 = (n) => [(n >> 8) & 0xFF, n & 0xFF];
    
    // Writes a number as a variable-length quantity (VLQ) for MIDI delta-times.
    const writeVariableLength = (n) => {
        let buf = [n & 0x7F];
        n >>= 7;
        while (n > 0) {
            buf.unshift((n & 0x7F) | 0x80);
            n >>= 7;
        }
        return buf;
    };
    
    // --- MIDI File Construction ---

    const TICKS_PER_BEAT = 480; // Standard ticks per quarter note for good resolution
    let noteEvents = [];

    // To ensure the MIDI file starts at or near tick 0, find the earliest beat.
    const firstBeat = circlesToExport.length > 0 ? Math.min(...circlesToExport.map(c => c.relativeX)) : 0;

    circlesToExport.forEach(circle => {
        // Calculate start tick relative to the first note in the export selection
        const startTick = Math.round((circle.relativeX - firstBeat) * TICKS_PER_BEAT);
        
        if (startTick >= 0) {
            // Calculate duration in beats, then in ticks
            const durationInBeats = (circle.playLength * currentTempo) / 60;
            const durationTicks = Math.round(durationInBeats * TICKS_PER_BEAT);
            
            const midiNote = frequencyToMidiNote(circle.frequency);
            const velocity = Math.max(1, Math.min(127, circle.velocity || 100));

            // Add two events for each note: Note On and Note Off
            noteEvents.push({ type: 'on',  tick: startTick, note: midiNote, velocity: velocity, channel: 0 });
            noteEvents.push({ type: 'off', tick: startTick + durationTicks, note: midiNote, velocity: 0, channel: 0 });
        }
    });
    
    if (noteEvents.length === 0) {
        alert("No notes to export.");
        return;
    }

    // Sort all events by their tick time, which is crucial for MIDI format
    noteEvents.sort((a, b) => a.tick - b.tick);

    let trackBytes = [];
    
    // Set Tempo Meta Event at the beginning of the track
    const microsecondsPerQuarterNote = Math.round(60000000 / currentTempo);
    trackBytes.push(
        0x00, // Delta-time 0 for the first event
        0xFF, 0x51, 0x03, // Meta event for Set Tempo
        (microsecondsPerQuarterNote >> 16) & 0xFF,
        (microsecondsPerQuarterNote >> 8) & 0xFF,
        microsecondsPerQuarterNote & 0xFF
    );
    
    let lastTick = 0;
    noteEvents.forEach(event => {
        const delta = event.tick - lastTick;
        trackBytes.push(...writeVariableLength(delta));
        
        const status = (event.type === 'on' ? 0x90 : 0x80) | event.channel;
        trackBytes.push(status, event.note, event.velocity);
        
        lastTick = event.tick;
    });

    // Add End of Track Meta Event
    trackBytes.push(...writeVariableLength(0), 0xFF, 0x2F, 0x00);
    
    // --- Assemble the final MIDI file ---

    // MIDI Header Chunk: MThd, length (6), format (0 = single track), num tracks (1), ticks/beat
    const header = [
        ...writeStringToBytes('MThd'),
        ...write32(6),
        ...write16(0), // Format 0
        ...write16(1), // 1 Track
        ...write16(TICKS_PER_BEAT)
    ];
    
    // Track Header Chunk: MTrk, length of track data
    const trackHeader = [
        ...writeStringToBytes('MTrk'),
        ...write32(trackBytes.length)
    ];

    // Combine all parts into a single byte array
    const midiBytes = new Uint8Array([...header, ...trackHeader, ...trackBytes]);
    const blob = new Blob([midiBytes], { type: 'audio/midi' });

    // Create a download link and trigger it
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `sequencer-midi-export-${Date.now()}.mid`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
}


async function importFromMidiFile(file, callback) {
    if (!file) return;
    if (typeof window.Midi === 'undefined') {
        alert("MIDI parsing library is not loaded yet. Please wait a moment and try again.");
        return;
    }
    try {
        const arrayBuffer = await file.arrayBuffer();
        const midi = new window.Midi(arrayBuffer);

        const newTempo = midi.header.tempos[0]?.bpm || 120;
        const newCircles = [];
        let newCircleCounter = 0;

        midi.tracks.forEach(track => {
            track.notes.forEach(note => {
                newCircleCounter++;
                const newCircle = {
                    id: newCircleCounter,
                    relativeX: (note.time * (newTempo / 60)) + START_BEAT,
                    frequency: midiNoteToFrequency(note.midi),
                    playLength: note.duration,
                    velocity: Math.round(note.velocity * 127),
                    playedThisCycle: false,
                    colliding: false
                };
                newCircles.push(newCircle);
            });
        });
        
        callback({
            circles: newCircles,
            tempo: newTempo,
            circleCounter: newCircleCounter
        });

    } catch (e) {
        alert("Could not parse MIDI file. It may be invalid or corrupted.");
        console.error("MIDI parsing error:", e);
    }
}

function onMidiImportSuccess(data) {
    if (confirm("Importing this MIDI file will replace your current project. Continue?")) {
        circles = data.circles;
        tempo = data.tempo;
        circleCounter = data.circleCounter;
        tempoInput.value = tempo;
        isPlaying = false;
        playBtn.textContent = 'Play';
        playheadPosition = START_BEAT * PIXELS_PER_BEAT;

        // NEW: Update beats input based on loaded file content
        const maxNoteBeat = circles.length > 0 ? Math.max(...circles.map(c => c.relativeX)) : START_BEAT;
        const requiredBeats = Math.ceil(maxNoteBeat) - START_BEAT;
        totalBeatsInput.value = Math.max(4, Math.ceil(requiredBeats / 4) * 4);

        updateCanvasWidth();
        draw();
    }
    midiFileInput.value = '';
}
