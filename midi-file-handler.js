/**
 * midi-file-handler.js
 * Contains functions to export the sequencer project to a Standard MIDI File (.mid)
 * and import notes from a .mid file into the project.
 * 
 * Dependencies:
 * - MidiWriter.js (for exporting) - must be included in the main HTML file.
 * - MidiParser.js (for importing) - must be included in the main HTML file.
 */

/**
 * Converts the sequencer's notes and tempo into a MIDI file and triggers a download.
 * @param {Array} circles - The array of note objects from the sequencer.
 * @param {number} tempo - The project's tempo in beats per minute (BPM).
 */
function exportToMidiFile(circles, tempo) {
    if (typeof MidiWriter === 'undefined') {
        alert("MidiWriter.js library is not loaded. Cannot export MIDI file.");
        return;
    }

    // 1. Create a new track
    const track = new MidiWriter.Track();

    // 2. Set the tempo
    track.setTempo(tempo);

    // 3. Add notes to the track
    // The library needs a 'startTick', 'duration' in ticks, and 'pitch'.
    // A "tick" is a unit of time in MIDI. We'll use the library's default (128 ticks per beat/quarter note).
    const TicksPerBeat = 128;
    const pixelsPerBeat = 50; // This is the constant from our main script.

    circles.forEach(note => {
        // Convert the note's pixel position (relativeX) to a start tick.
        const startBeat = note.relativeX / pixelsPerBeat;
        const startTick = Math.round(startBeat * TicksPerBeat);

        // Convert the note's duration in seconds to a duration in ticks.
        const durationInBeats = (note.playLength * tempo) / 60;
        const durationTicks = Math.round(durationInBeats * TicksPerBeat);
        
        // Convert the frequency to a MIDI note number.
        const midiNoteNumber = Math.round(69 + 12 * Math.log2(note.frequency / 440));

        // Create a new note event.
        const noteEvent = new MidiWriter.NoteEvent({
            pitch: [midiNoteNumber],
            startTick: startTick,
            duration: 'T' + durationTicks // 'T' prefix specifies duration in ticks.
        });

        // Add the event to the track
        track.addEvent(noteEvent);
    });

    // 4. Generate the MIDI file
    const write = new MidiWriter.Writer([track]);

    // 5. Trigger the download
    const blob = write.buildBlob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sequencer-export-${Date.now()}.mid`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}


/**
 * Parses a MIDI file and converts its note data into the sequencer's format.
 * @param {File} file - The .mid file selected by the user.
 * @param {Function} callback - A function to call with the imported data.
 */
function importFromMidiFile(file, callback) {
    if (typeof MidiParser === 'undefined') {
        alert("MidiParser.js library is not loaded. Cannot import MIDI file.");
        return;
    }

    const reader = new FileReader();

    reader.onload = function(e) {
        try {
            const midiFile = new MidiParser(e.target.result);
            
            const TicksPerBeat = midiFile.ticksPerBeat;
            const tempoEvents = midiFile.getTempoEvents();
            const projectTempo = tempoEvents.length > 0 ? tempoEvents[0].bpm : 120; // Use first tempo event or default.

            const importedCircles = [];
            let noteCounter = 0;

            // Iterate through all MIDI events in all tracks
            midiFile.getEvents().forEach(event => {
                // We only care about 'note on' events with velocity > 0
                if (event.type === 9 && event.velocity > 0) {
                    noteCounter++;
                    
                    const midiNoteNumber = event.note;
                    const frequency = 440 * Math.pow(2, (midiNoteNumber - 69) / 12);
                    
                    // Convert tick-based times to our sequencer's format
                    const startBeat = event.tick / TicksPerBeat;
                    const durationBeat = event.duration / TicksPerBeat;

                    const pixelsPerBeat = 50; // From our main script
                    const relativeX = startBeat * pixelsPerBeat;
                    const playLength = (durationBeat * 60) / projectTempo; // Convert duration from beats to seconds

                    importedCircles.push({
                        id: noteCounter,
                        relativeX: relativeX,
                        frequency: frequency,
                        playLength: playLength,
                        playedThisCycle: false,
                        colliding: false
                    });
                }
            });

            if (importedCircles.length === 0) {
                alert("No notes found in this MIDI file.");
                return;
            }

            // Send the converted data back to the main application
            callback({
                tempo: projectTempo,
                circles: importedCircles
            });

        } catch (error) {
            console.error("Error parsing MIDI file:", error);
            alert("Could not parse the MIDI file. It might be corrupted or in an unsupported format.");
        }
    };

    reader.readAsBinaryString(file);
}