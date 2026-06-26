export function showSuccess(message) {
  showNotification(message, 'success');
}

export function showNotification(message, type = 'info') {
  const existingNotification = document.getElementById('export-notification');
  existingNotification?.remove();

  const notification = document.createElement('div');
  notification.id = 'export-notification';
  notification.className = `export-notification ${type}`;
  notification.textContent = message;

  document.body.appendChild(notification);

  notification.style.position = 'fixed';
  notification.style.top = '20px';
  notification.style.left = '50%';
  notification.style.transform = 'translateX(-50%)';
  notification.style.zIndex = '10000';

  setTimeout(() => {
    notification.classList.add('show');
  }, 10);

  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => {
      notification.remove();
    }, 300);
  }, 3000);
}

export function showCopyNotification(message) {
  const existingNotification = document.getElementById('copy-notification');
  existingNotification?.remove();

  const notification = document.createElement('div');
  notification.id = 'copy-notification';
  notification.className = 'copy-notification';
  notification.textContent = message;

  document.body.appendChild(notification);

  const copyBtn = document.getElementById('copy-all-btn');
  if (copyBtn) {
    const btnRect = copyBtn.getBoundingClientRect();
    notification.style.position = 'fixed';
    notification.style.top = `${btnRect.bottom + 8}px`;
    notification.style.right = '24px';
    notification.style.zIndex = '10000';
  }

  setTimeout(() => {
    notification.classList.add('show');
  }, 10);

  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => {
      notification.remove();
    }, 300);
  }, 2000);
}
