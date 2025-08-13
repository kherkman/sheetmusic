// --- saveToJPG.js ---

/**
 * Initializes the "Save to JPG" button functionality.
 * This function handles the process of converting the canvas content to a JPG image.
 *
 * @param {HTMLButtonElement} saveJpgBtn - The "Save to JPG" button element from the HTML.
 * @param {HTMLCanvasElement} canvasElement - The main canvas element that needs to be captured.
 * @param {Function} getThemeCanvasColor - A function that returns the current canvas background color string. This ensures the saved JPG always has the correct theme background.
 */
function setupJpgExport(saveJpgBtn, canvasElement, getThemeCanvasColor) {
    // Exit if the required elements aren't found.
    if (!saveJpgBtn || !canvasElement) {
        console.error("Save to JPG button or canvas element not found.");
        return;
    }

    // Add a click event listener to the button.
    saveJpgBtn.addEventListener('click', () => {
        console.log("Generating JPG...");

        // Get the current background color at the time of the click.
        const backgroundColor = getThemeCanvasColor();

        try {
            // Create a temporary, off-screen canvas. This is crucial for applying a background
            // color, as the default canvas export can have transparency, which JPG doesn't support well.
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = canvasElement.width;
            tempCanvas.height = canvasElement.height;
            const tempCtx = tempCanvas.getContext('2d');

            // 1. Fill the temporary canvas with the current theme's background color.
            tempCtx.fillStyle = backgroundColor || '#ffffff'; // Default to white if color is somehow null
            tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

            // 2. Draw the visible sequencer canvas on top of the background.
            tempCtx.drawImage(canvasElement, 0, 0);

            // 3. Convert the content of the temporary canvas to a JPG data URL.
            // The second argument (0.9) sets the image quality (from 0.0 to 1.0).
            const canvasImage = tempCanvas.toDataURL('image/jpeg', 0.9);

            // 4. Create a temporary link element to trigger the download.
            const link = document.createElement('a');
            link.href = canvasImage;
            link.download = `sequencer-output-${Date.now()}.jpg`;

            // 5. Append, click, and then remove the link to initiate the download without navigating.
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

        } catch (error) {
            console.error("Failed to generate JPG:", error);
            alert("Could not generate the JPG. There was an unexpected error.");
        }
    });
}