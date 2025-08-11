
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

function exportToMidiFile(circlesToExport, currentTempo) {
    if (typeof window.MidiWriter === 'undefined') {
        alert("MIDI Writer library is not loaded yet. Please wait a moment and try again.");
        return;
    }
    const writer = new window.MidiWriter.Writer();
    const track = new window.MidiWriter.Track();
    writer.addTrack(track);

    track.setTempo(currentTempo);

    const TPQN = 128;

    circlesToExport.forEach(circle => {
        const startTick = Math.round((circle.relativeX - START_BEAT) * TPQN);
        
        if (startTick >= 0) {
            const durationInBeats = (circle.playLength * currentTempo) / 60;
            const durationTicks = Math.round(durationInBeats * TPQN);

            const noteEvent = new window.MidiWriter.NoteEvent({
                pitch: frequencyToMidiNote(circle.frequency),
                startTick: startTick,
                duration: 'T' + durationTicks,
                velocity: circle.velocity
            });
            track.addEvent(noteEvent);
        }
    });

    const dataUri = writer.dataUri();
    const a = document.createElement('a');
    a.href = dataUri;
    a.download = `sequencer-midi-export-${Date.now()}.mid`;
    a.click();
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