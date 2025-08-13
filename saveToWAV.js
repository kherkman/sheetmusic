// --- saveToWAV.js ---

/**
 * Initializes the "Save to WAV" button functionality.
 *
 * @param {HTMLButtonElement} saveWavBtn - The "Save to WAV" button element.
 * @param {Function} getNotesData - A function that returns an object with { circles, tempo, baseFrequency, roundRobinBuffers }.
 */
function setupWavExport(saveWavBtn, getNotesData) {
    if (!saveWavBtn) {
        console.error("Save to WAV button not found.");
        return;
    }

    saveWavBtn.addEventListener('click', async () => {
        const { circles, tempo, baseFrequency, roundRobinBuffers } = getNotesData();

        if (circles.length === 0) {
            alert("There are no notes to save.");
            return;
        }
        if (roundRobinBuffers.length === 0) {
            alert("The audio sample is not loaded yet. Cannot render audio.");
            return;
        }

        alert("Rendering audio... This may take a moment. The page might be unresponsive.");
        console.log("Starting WAV export...");

        try {
            // Calculate total duration of the sequence
            const beatsPerSecond = tempo / 60;
            const lastNote = circles.reduce((last, note) => note.relativeX > last.relativeX ? note : last, circles[0]);
            const totalDurationInSeconds = (lastNote.relativeX / beatsPerSecond) + lastNote.playLength + 1.0; // Add 1s padding

            // Create an OfflineAudioContext
            const offlineCtx = new OfflineAudioContext({
                numberOfChannels: 2,
                length: 44100 * totalDurationInSeconds,
                sampleRate: 44100,
            });

            // Re-create the main gain node for the offline context
            const masterGain = offlineCtx.createGain();
            masterGain.connect(offlineCtx.destination);
            masterGain.gain.value = 0.7; // Set a default volume for rendering

            // Schedule all notes to be played in the offline context
            circles.forEach((note, index) => {
                const startTimeInSeconds = (note.relativeX - START_BEAT) / beatsPerSecond;
                const bufferToPlay = roundRobinBuffers[index % roundRobinBuffers.length];

                const noteGain = offlineCtx.createGain();
                noteGain.gain.value = (note.velocity / 127) * (note.velocity / 127);
                noteGain.connect(masterGain);

                const source = offlineCtx.createBufferSource();
                source.buffer = bufferToPlay;
                source.playbackRate.value = note.frequency / baseFrequency;
                source.connect(noteGain);

                source.start(startTimeInSeconds);
                source.stop(startTimeInSeconds + note.playLength);
            });

            // Start rendering
            const renderedBuffer = await offlineCtx.startRendering();

            // Convert the buffer to a WAV file
            const wavBlob = bufferToWav(renderedBuffer);

            // Create a download link and trigger it
            const anchor = document.createElement('a');
            anchor.href = URL.createObjectURL(wavBlob);
            anchor.download = `sequencer-output-${Date.now()}.wav`;
            anchor.click();
            URL.revokeObjectURL(anchor.href);

            console.log("WAV export successful.");
            alert("Audio has been rendered and downloaded as a .wav file.");

        } catch (error) {
            console.error("Failed to render WAV file:", error);
            alert("An error occurred while rendering the audio. Please check the console for details.");
        }
    });
}

/**
 * Encodes an AudioBuffer into a WAV file format (Blob).
 * @param {AudioBuffer} buffer - The audio buffer to encode.
 * @returns {Blob} A Blob object representing the WAV file.
 */
function bufferToWav(buffer) {
    const numOfChan = buffer.numberOfChannels;
    const length = buffer.length * numOfChan * 2 + 44;
    const bufferArray = new ArrayBuffer(length);
    const view = new DataView(bufferArray);
    const channels = [];
    let i, sample;
    let offset = 0;
    let pos = 0;

    // Helper function to write strings
    const writeString = (s) => {
        for (i = 0; i < s.length; i++) {
            view.setUint8(offset + i, s.charCodeAt(i));
        }
    };

    // RIFF chunk descriptor
    writeString('RIFF'); offset += 4;
    view.setUint32(offset, length - 8, true); offset += 4;
    writeString('WAVE'); offset += 4;

    // FMT sub-chunk
    writeString('fmt '); offset += 4;
    view.setUint32(offset, 16, true); offset += 4; // Subchunk1Size
    view.setUint16(offset, 1, true); offset += 2; // AudioFormat (PCM)
    view.setUint16(offset, numOfChan, true); offset += 2; // NumChannels
    view.setUint32(offset, buffer.sampleRate, true); offset += 4; // SampleRate
    view.setUint32(offset, buffer.sampleRate * 4, true); offset += 4; // ByteRate
    view.setUint16(offset, numOfChan * 2, true); offset += 2; // BlockAlign
    view.setUint16(offset, 16, true); offset += 2; // BitsPerSample

    // DATA sub-chunk
    writeString('data'); offset += 4;
    view.setUint32(offset, length - pos - 4, true); offset += 4;

    // Write the PCM samples
    for (i = 0; i < buffer.numberOfChannels; i++) {
        channels.push(buffer.getChannelData(i));
    }

    while (pos < buffer.length) {
        for (i = 0; i < numOfChan; i++) {
            sample = Math.max(-1, Math.min(1, channels[i][pos]));
            sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
            view.setInt16(offset, sample, true);
            offset += 2;
        }
        pos++;
    }

    return new Blob([view], { type: 'audio/wav' });
}


// Example of how to connect this to your main HTML file:
// 1. Add a "saveWavBtn" id to your "Save to WAV" button in index.html.
// 2. In your main script's init() or addEventListeners() function, add the following line:
//    setupWavExport(document.getElementById('saveWavBtn'), () => ({ circles, tempo, baseFrequency, roundRobinBuffers }));