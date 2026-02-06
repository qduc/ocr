import type { OCRResult } from '@/types/ocr-engine';

const renderOverlay = (
  overlay: HTMLDivElement,
  image: HTMLImageElement,
  items: OCRResult['items'],
  originalWidth: number,
  originalHeight: number
): void => {
  if (!items) return;
  overlay.innerHTML = '';

  const displayWidth = image.clientWidth;
  const displayHeight = image.clientHeight;

  if (displayWidth === 0 || displayHeight === 0) return;

  const scaleX = displayWidth / originalWidth;
  const scaleY = displayHeight / originalHeight;

  items.forEach((item) => {
    const box = document.createElement('div');
    box.className = 'ocr-box';
    box.style.left = `${item.boundingBox.x * scaleX}px`;
    box.style.top = `${item.boundingBox.y * scaleY}px`;
    box.style.width = `${item.boundingBox.width * scaleX}px`;
    box.style.height = `${item.boundingBox.height * scaleY}px`;
    box.title = `${item.text} (${Math.round(item.confidence * 100)}%) - Click to copy`;
    box.setAttribute('data-text', item.text);

    const topPos = item.boundingBox.y * scaleY;
    if (topPos < 32) {
      box.classList.add('at-top');
    }

    box.addEventListener('click', (e) => {
      e.stopPropagation();
      void navigator.clipboard.writeText(item.text).then(() => {
        box.classList.add('copied');
        const originalText = box.getAttribute('data-text');
        box.setAttribute('data-text', 'Copied!');
        setTimeout(() => {
          box.classList.remove('copied');
          box.setAttribute('data-text', originalText || item.text);
        }, 1500);
      });
    });

    overlay.appendChild(box);
  });
};

export const drawOcrBoxes = (
  items: OCRResult['items'],
  originalWidth: number,
  originalHeight: number,
  options: {
    mainOverlay: HTMLDivElement;
    mainImage: HTMLImageElement;
    modalOverlay: HTMLDivElement;
    modalImage: HTMLImageElement;
    isModalOpen: () => boolean;
  }
): void => {
  if (!items) return;

  const updateMain = (): void => {
    renderOverlay(options.mainOverlay, options.mainImage, items, originalWidth, originalHeight);
  };

  const updateModal = (): void => {
    renderOverlay(options.modalOverlay, options.modalImage, items, originalWidth, originalHeight);
  };

  if (options.mainImage.complete) {
    updateMain();
  } else {
    options.mainImage.addEventListener('load', updateMain, { once: true });
  }

  if (options.isModalOpen()) {
    if (options.modalImage.complete) {
      updateModal();
    } else {
      options.modalImage.addEventListener('load', updateModal, { once: true });
    }
  }
};
