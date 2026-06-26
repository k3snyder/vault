import { EditorView } from '@codemirror/view';
import { invoke } from '@tauri-apps/api/core';
import { refreshFileTree } from '../app/file-tree-view.js';

/**
 * Extension for handling image paste events in CodeMirror
 * Saves pasted images to vault's files folder and inserts  syntax
 */
export function imagePasteExtension() {
  return EditorView.domEventHandlers({
    paste(event, view) {
      console.log('📋 Paste event detected');
      const clipboardData = event.clipboardData;
      if (!clipboardData) return false;

      // Check for image data
      const items = Array.from(clipboardData.items);
      const imageItem = items.find((item) => item.type.startsWith('image/'));

      if (imageItem) {
        console.log('🖼️ Image detected in clipboard:', imageItem.type);
        event.preventDefault();

        // Handle the image paste
        handleImagePaste(imageItem, view);
        return true;
      }

      return false;
    },
  });
}

async function handleImagePaste(imageItem, view) {
  try {
    // Get file extension
    const mimeType = imageItem.type;
    const extension = mimeType.split('/')[1].replace('jpeg', 'jpg');

    // Only support png, jpg, gif
    if (!['png', 'jpg', 'gif'].includes(extension)) {
      console.error('❌ Unsupported image format:', extension);
      return;
    }

    console.log('📸 Processing image with extension:', extension);

    // Convert to blob and then to base64
    const blob = imageItem.getAsFile();
    if (!blob) {
      console.error('❌ Failed to get file from clipboard');
      return;
    }

    const base64 = await blobToBase64(blob);

    // Remove data URL prefix to get pure base64
    const base64Data = base64.split(',')[1];

    console.log('💾 Saving image via Tauri backend...');

    // Save image via Tauri
    const filename = await invoke('save_pasted_image', {
      imageData: base64Data,
      extension: extension,
    });

    console.log('✅ Image saved as:', filename);

    // Insert  syntax at cursor position
    const pos = view.state.selection.main.head;
    const transaction = view.state.update({
      changes: {
        from: pos,
        to: pos,
        insert: `![[${filename}]]`,
      },
      selection: {
        anchor: pos + `![[${filename}]]`.length,
      },
    });

    view.dispatch(transaction);
    console.log('📝 Inserted image reference in editor');

    // Refresh file tree to show the new files folder
    refreshFileTree();
  } catch (error) {
    console.error('❌ Failed to paste image:', error);
    // Could show a user-friendly error notification here
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
