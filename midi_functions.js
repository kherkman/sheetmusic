// --- MIDI Functions ---

// --- NEW: Configuration and State for Polyphonic Pitch Bend ---
const PITCH_BEND_RANGE_SEMITONES = 2; // Set how many semitones the bend will cover up/down. 2 is a common standard.
let midiChannelManager = {
    channels: [], // Will be populated with { channel: number, inUse: boolean, note: number, timeoutId: number }
    isInitialized: false, // Tracks if pitch bend range has been set for the current output
    // A mapping of MIDI channels to use. Skips channel 9 (the 10th channel), which is conventionally for drums.
    channelPool: [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15] 
};


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
    
    // Reset the channel manager if MIDI access is re-acquired
    midiChannelManager.isInitialized = false;
}

function onMIDIFailure(msg) { console.error(`Failed to get MIDI access - ${msg}`); }

function setMidiInput(e) {
    if (activeMidiInput) activeMidiInput.removeEventListener('midimessage', onMidiMessage);
    activeMidiInput = midiAccess.inputs.get(e.target.value);
    if (activeMidiInput) activeMidiInput.addEventListener('midimessage', onMidiMessage);
}

function setMidiOutput(e) { 
    activeMidiOutput = midiAccess.outputs.get(e.target.value); 
    // When a new output is selected, we must (re)initialize the channels for it.
    if (activeMidiOutput) {
        initializeMidiChannels(activeMidiOutput);
    } else {
        midiChannelManager.isInitialized = false;
    }
}

/**
 * NEW: Sends RPN messages to set the pitch bend range for all available channels.
 * This is essential for the synthesizer to correctly interpret our pitch bend values.
 * @param {MIDIOutput} output - The MIDI output device to configure.
 */
function initializeMidiChannels(output) {
    midiChannelManager.channels = [];
    console.log(`Initializing ${midiChannelManager.channelPool.length} MIDI channels for pitch bend...`);

    midiChannelManager.channelPool.forEach(channel => {
        // RPN sequence for setting Pitch Bend Sensitivity
        // 1. Select the Pitch Bend Sensitivity parameter (RPN 0,0)
        output.send([0xB0 | channel, 101, 0]); // RPN MSB
        output.send([0xB0 | channel, 100, 0]); // RPN LSB
        // 2. Set the range in semitones
        output.send([0xB0 | channel, 6, PITCH_BEND_RANGE_SEMITONES]); // Data Entry MSB
        output.send([0xB0 | channel, 38, 0]); // Data Entry LSB (for cents, usually 0)
        // 3. De-select the RPN (null)
        output.send([0xB0 | channel, 101, 127]);
        output.send([0xB0 | channel, 100, 127]);

        midiChannelManager.channels.push({ channel: channel, inUse: false, note: null, timeoutId: null });
    });

    midiChannelManager.isInitialized = true;
    console.log("MIDI channels initialized.");
}

/**
 * NEW: Helper function to find the closest integer MIDI note for a given frequency.
 * @param {number} frequency - The target frequency in Hz.
 * @returns {number} The closest standard MIDI note number (0-127).
 */
function frequencyToClosestMidiNote(frequency) {
    if (frequency <= 0) return 0;
    // This formula calculates the floating-point MIDI note number
    const midiNoteFloat = 69 + 12 * Math.log2(frequency / 440.0);
    return Math.round(midiNoteFloat);
}

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

/**
 * REWRITTEN: Plays a note of any frequency by finding the closest MIDI note
 * and using a pitch bend message to achieve the precise frequency.
 * It uses a pool of MIDI channels to allow for polyphonic bending.
 * @param {number} frequency - The exact frequency to play.
 * @param {number} playLength - The duration of the note in seconds.
 * @param {number} velocity - The MIDI velocity (1-127).
 */
function playNoteOnMidiOutput(frequency, playLength, velocity) {
    if (!activeMidiOutput || !midiChannelManager.isInitialized) return;

    // 1. Find a free MIDI channel
    const availableChannel = midiChannelManager.channels.find(ch => !ch.inUse);
    if (!availableChannel) {
        console.warn("No free MIDI channels for pitch bend. Note dropped.");
        return;
    }

    // 2. Calculate nearest note and required pitch bend
    const closestMidiNote = frequencyToClosestMidiNote(frequency);
    const standardNoteFrequency = 440.0 * Math.pow(2, (closestMidiNote - 69) / 12);
    
    // Cents are 1/100 of a semitone. The total range is 1200 cents per octave.
    const centsDeviation = 1200 * Math.log2(frequency / standardNoteFrequency);

    // 3. Convert cents to 14-bit MIDI pitch bend value (0-16383)
    // 8192 is the center (no bend).
    const centsPerBendUnit = (PITCH_BEND_RANGE_SEMITONES * 100) / 8191; // How many cents per unit of bend value
    let bendValue = 8192 + (centsDeviation / centsPerBendUnit);
    bendValue = Math.round(Math.max(0, Math.min(16383, bendValue)));

    const lsb = bendValue & 0x7F; // Least Significant Byte (lower 7 bits)
    const msb = (bendValue >> 7) & 0x7F; // Most Significant Byte (upper 7 bits)
    
    const channel = availableChannel.channel;

    // 4. Send the MIDI messages
    activeMidiOutput.send([0xE0 | channel, lsb, msb]); // Pitch Bend on the assigned channel
    activeMidiOutput.send([0x90 | channel, closestMidiNote, velocity]); // Note On

    // 5. Mark channel as in use and set timeout to turn it off
    availableChannel.inUse = true;
    availableChannel.note = closestMidiNote;

    availableChannel.timeoutId = setTimeout(() => {
        // Note Off
        activeMidiOutput.send([0x80 | channel, closestMidiNote, 0]);
        
        // Reset pitch bend for the channel to center (8192)
        activeMidiOutput.send([0xE0 | channel, 0x00, 0x40]); // LSB=0, MSB=64 -> 8192

        // Free up the channel
        availableChannel.inUse = false;
        availableChannel.note = null;
        availableChannel.timeoutId = null;
    }, playLength * 1000);
}


/**
 * REWRITTEN: Exports the sequence to a Standard MIDI File, including polyphonic pitch bend information.
 * Each note is assigned to a different MIDI channel to allow its pitch to be bent independently.
 * @param {Array} circlesToExport - The array of note objects to export.
 * @param {number} currentTempo - The current tempo of the project.
 */
function exportToMidiFile(circlesToExport, currentTempo) {
    const writeStringToBytes = (str) => Array.from(str).map(c => c.charCodeAt(0));
    const write32 = (n) => [(n >> 24) & 0xFF, (n >> 16) & 0xFF, (n >> 8) & 0xFF, n & 0xFF];
    const write16 = (n) => [(n >> 8) & 0xFF, n & 0xFF];
    const writeVariableLength = (n) => {
        let buf = [n & 0x7F];
        n >>= 7;
        while (n > 0) {
            buf.unshift((n & 0x7F) | 0x80);
            n >>= 7;
        }
        return buf;
    };

    const TICKS_PER_BEAT = 480;
    let noteEvents = [];
    let channelIndex = 0;
    const firstBeat = circlesToExport.length > 0 ? Math.min(...circlesToExport.map(c => c.relativeX)) : 0;

    circlesToExport.forEach(circle => {
        const startTick = Math.round((circle.relativeX - firstBeat) * TICKS_PER_BEAT);
        if (startTick < 0) return;

        const durationInBeats = (circle.playLength * currentTempo) / 60;
        const durationTicks = Math.round(durationInBeats * TICKS_PER_BEAT);
        const velocity = Math.max(1, Math.min(127, circle.velocity || 100));
        
        // Assign a channel from the pool in a round-robin fashion
        const channel = midiChannelManager.channelPool[channelIndex];
        channelIndex = (channelIndex + 1) % midiChannelManager.channelPool.length;
        
        // --- Pitch Bend Calculation ---
        const closestMidiNote = frequencyToClosestMidiNote(circle.frequency);
        const standardNoteFrequency = 440.0 * Math.pow(2, (closestMidiNote - 69) / 12);
        const centsDeviation = 1200 * Math.log2(circle.frequency / standardNoteFrequency);
        const centsPerBendUnit = (PITCH_BEND_RANGE_SEMITONES * 100) / 8191;
        let bendValue = 8192 + (centsDeviation / centsPerBendUnit);
        bendValue = Math.round(Math.max(0, Math.min(16383, bendValue)));
        const lsb = bendValue & 0x7F;
        const msb = (bendValue >> 7) & 0x7F;
        // --- End Pitch Bend Calculation ---

        // Add three events: Pitch Bend, Note On, Note Off
        noteEvents.push({ type: 'bend', tick: startTick, lsb: lsb, msb: msb, channel: channel });
        noteEvents.push({ type: 'on', tick: startTick, note: closestMidiNote, velocity: velocity, channel: channel });
        noteEvents.push({ type: 'off', tick: startTick + durationTicks, note: closestMidiNote, velocity: 0, channel: channel });
    });

    if (noteEvents.length === 0) {
        alert("No notes to export.");
        return;
    }

    // Sort events by tick. If ticks are equal, sort by type ('bend' before 'on').
    noteEvents.sort((a, b) => {
        if (a.tick !== b.tick) return a.tick - b.tick;
        const typeOrder = { 'bend': 0, 'on': 1, 'off': 2 };
        return (typeOrder[a.type] || 99) - (typeOrder[b.type] || 99);
    });

    let trackBytes = [];
    // Set Tempo event
    const microsecondsPerQuarterNote = Math.round(60000000 / currentTempo);
    trackBytes.push(0x00, 0xFF, 0x51, 0x03, (microsecondsPerQuarterNote >> 16) & 0xFF, (microsecondsPerQuarterNote >> 8) & 0xFF, microsecondsPerQuarterNote & 0xFF);

    // Set Pitch Bend Range for all channels at the beginning of the track (delta time 0)
    midiChannelManager.channelPool.forEach(channel => {
        trackBytes.push(0x00, 0xB0 | channel, 101, 0);   // RPN MSB
        trackBytes.push(0x00, 0xB0 | channel, 100, 0);   // RPN LSB
        trackBytes.push(0x00, 0xB0 | channel, 6, PITCH_BEND_RANGE_SEMITONES); // Data Entry MSB
        trackBytes.push(0x00, 0xB0 | channel, 38, 0);    // Data Entry LSB
        trackBytes.push(0x00, 0xB0 | channel, 101, 127); // Null RPN
        trackBytes.push(0x00, 0xB0 | channel, 100, 127); // Null RPN
    });

    let lastTick = 0;
    noteEvents.forEach(event => {
        const delta = event.tick - lastTick;
        trackBytes.push(...writeVariableLength(delta));
        let status;
        if (event.type === 'on') {
            status = 0x90 | event.channel;
            trackBytes.push(status, event.note, event.velocity);
        } else if (event.type === 'off') {
            status = 0x80 | event.channel;
            trackBytes.push(status, event.note, event.velocity);
        } else if (event.type === 'bend') {
            status = 0xE0 | event.channel;
            trackBytes.push(status, event.lsb, event.msb);
        }
        lastTick = event.tick;
    });

    trackBytes.push(...writeVariableLength(0), 0xFF, 0x2F, 0x00); // End of Track
    const header = [...writeStringToBytes('MThd'), ...write32(6), ...write16(0), ...write16(1), ...write16(TICKS_PER_BEAT)];
    const trackHeader = [...writeStringToBytes('MTrk'), ...write32(trackBytes.length)];
    const midiBytes = new Uint8Array([...header, ...trackHeader, ...trackBytes]);
    const blob = new Blob([midiBytes], { type: 'audio/midi' });
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

        const maxNoteBeat = circles.length > 0 ? Math.max(...circles.map(c => c.relativeX)) : START_BEAT;
        const requiredBeats = Math.ceil(maxNoteBeat) - START_BEAT;
        totalBeatsInput.value = Math.max(4, Math.ceil(requiredBeats / 4) * 4);

        updateCanvasWidth();
        draw();
    }
    midiFileInput.value = '';
}
