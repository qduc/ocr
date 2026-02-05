export interface ImageSourceElements {
  fileInput: HTMLInputElement;
  fileMeta: HTMLDivElement;
  imagePreviewContainer: HTMLDivElement;
  imagePreview: HTMLImageElement;
  urlInput: HTMLInputElement;
  loadUrlButton: HTMLButtonElement;
  dropOverlay: HTMLDivElement;
  methodTabs: HTMLButtonElement[];
  methodPanels: HTMLDivElement[];
  output: HTMLDivElement;
}

export interface ImageSourceCallbacks {
  setError: (error: unknown) => void;
  onLoadImage: (source: Blob | string, previewUrl: string | null) => void;
  onClearImage: () => void;
  onPreviewLoaded: () => void;
  onResetForNewSource: () => void;
}

export interface ImageSourceController {
  loadImage: (source: Blob | string) => void;
  getSelectedSource: () => Blob | string | null;
  getPreviewUrl: () => string | null;
  setPreviewUrl: (next: string | null) => void;
}

export const createImageSourceController = (
  elements: ImageSourceElements,
  callbacks: ImageSourceCallbacks
): ImageSourceController => {
  const {
    fileInput,
    fileMeta,
    imagePreviewContainer,
    imagePreview,
    urlInput,
    loadUrlButton,
    dropOverlay,
    methodTabs,
    methodPanels,
    output,
  } = elements;

  let selectedSource: Blob | string | null = null;
  let currentPreviewUrl: string | null = null;

  const setActiveMethod = (method: string): void => {
    methodTabs.forEach((tab): void => {
      const isActive = tab.dataset.method === method;
      tab.classList.toggle('is-active', isActive);
      tab.setAttribute('aria-selected', String(isActive));
    });
    methodPanels.forEach((panel): void => {
      panel.classList.toggle('is-active', panel.dataset.method === method);
    });
    if (method === 'file') {
      fileInput.focus();
    } else if (method === 'url') {
      urlInput.focus();
    }
  };

  const setPreviewUrl = (next: string | null): void => {
    currentPreviewUrl = next;
  };

  const getPreviewUrl = (): string | null => currentPreviewUrl;

  const getSelectedSource = (): Blob | string | null => selectedSource;

  const loadImage = (source: Blob | string): void => {
    if (currentPreviewUrl) {
      URL.revokeObjectURL(currentPreviewUrl);
      currentPreviewUrl = null;
    }

    selectedSource = source;

    if (source instanceof File) {
      fileMeta.textContent = `${source.name} (${Math.round(source.size / 1024)} KB)`;
    } else if (source instanceof Blob) {
      fileMeta.textContent = `Pasted image (${Math.round(source.size / 1024)} KB)`;
    } else {
      fileMeta.textContent = `URL: ${source.substring(0, 30)}${source.length > 30 ? '...' : ''}`;
    }

    output.textContent = 'Image loaded. Click extract to run OCR.';

    if (source instanceof Blob) {
      currentPreviewUrl = URL.createObjectURL(source);
      imagePreview.removeAttribute('crossorigin');
      imagePreview.src = currentPreviewUrl;
    } else {
      imagePreview.crossOrigin = 'anonymous';
      imagePreview.src = source;
    }

    imagePreviewContainer.classList.remove('hidden');
    callbacks.onResetForNewSource();
    callbacks.onLoadImage(source, currentPreviewUrl);
  };

  imagePreview.addEventListener('error', (): void => {
    if (imagePreview.getAttribute('src')) {
      callbacks.setError(new Error('Failed to load image. Check the URL or file format.'));
      imagePreviewContainer.classList.add('hidden');
      selectedSource = null;
      callbacks.onClearImage();
    }
  });

  fileInput.addEventListener('change', (): void => {
    const file = fileInput.files?.[0];
    if (file) {
      setActiveMethod('file');
      loadImage(file);
    } else {
      imagePreviewContainer.classList.add('hidden');
      selectedSource = null;
      fileMeta.textContent = 'No file selected.';
      output.textContent = 'Upload an image to begin.';
      callbacks.onClearImage();
    }
  });

  loadUrlButton.addEventListener('click', (): void => {
    const url = urlInput.value.trim();
    if (url) {
      setActiveMethod('url');
      loadImage(url);
    }
  });

  urlInput.addEventListener('keypress', (e: KeyboardEvent): void => {
    if (e.key === 'Enter') {
      const url = urlInput.value.trim();
      if (url) {
        setActiveMethod('url');
        loadImage(url);
      }
    }
  });

  methodTabs.forEach((tab): void => {
    tab.addEventListener('click', (): void => {
      const method = tab.dataset.method ?? 'file';
      setActiveMethod(method);
    });
  });
  setActiveMethod(methodTabs[0]?.dataset.method ?? 'file');

  const handlePaste = (e: ClipboardEvent): void => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const blob = item.getAsFile();
        if (blob) {
          setActiveMethod('file');
          loadImage(blob);
          break;
        }
      }
    }
  };

  document.addEventListener('paste', handlePaste);

  let dragCounter = 0;

  document.addEventListener('dragenter', (e): void => {
    e.preventDefault();
    dragCounter++;
    dropOverlay.classList.remove('hidden');
  });

  document.addEventListener('dragover', (e): void => {
    e.preventDefault();
  });

  document.addEventListener('dragleave', (): void => {
    dragCounter--;
    if (dragCounter === 0) {
      dropOverlay.classList.add('hidden');
    }
  });

  document.addEventListener('drop', (e): void => {
    e.preventDefault();
    dragCounter = 0;
    dropOverlay.classList.add('hidden');
    const file = e.dataTransfer?.files[0];
    if (file && file.type.startsWith('image/')) {
      setActiveMethod('file');
      loadImage(file);
    }
  });

  return {
    loadImage,
    getSelectedSource,
    getPreviewUrl,
    setPreviewUrl,
  };
};
