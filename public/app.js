const form = document.getElementById('pdfForm');
const fileInput = document.getElementById('fileInput');
const dropZone = document.getElementById('dropZone');
const fileInfo = document.getElementById('fileInfo');
const fileName = document.getElementById('fileName');
const removeFile = document.getElementById('removeFile');
const submitBtn = document.getElementById('submitBtn');
const loading = document.getElementById('loading');
const successMsg = document.getElementById('successMsg');
const errorMsg = document.getElementById('errorMsg');

// Click to browse
dropZone.addEventListener('click', () => fileInput.click());

// Drag and drop
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('border-blue-400', 'bg-blue-50');
});
dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('border-blue-400', 'bg-blue-50');
});
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('border-blue-400', 'bg-blue-50');
  const file = e.dataTransfer.files[0];
  if (file && file.type === 'application/pdf') {
    fileInput.files = e.dataTransfer.files;
    showFile(file.name);
  }
});

// File selected
fileInput.addEventListener('change', () => {
  if (fileInput.files.length > 0) {
    showFile(fileInput.files[0].name);
  }
});

function showFile(name) {
  fileName.textContent = name;
  fileInfo.classList.remove('hidden');
  dropZone.classList.add('hidden');
  submitBtn.disabled = false;
  successMsg.classList.add('hidden');
  errorMsg.classList.add('hidden');
}

// Remove file
removeFile.addEventListener('click', () => {
  fileInput.value = '';
  fileInfo.classList.add('hidden');
  dropZone.classList.remove('hidden');
  submitBtn.disabled = true;
});

// Submit via fetch to trigger download with original name
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!fileInput.files.length) return;

  loading.classList.remove('hidden');
  successMsg.classList.add('hidden');
  errorMsg.classList.add('hidden');
  submitBtn.disabled = true;

  const formData = new FormData();
  formData.append('pdf', fileInput.files[0]);

  try {
    const response = await fetch('/convert', { method: 'POST', body: formData });
    if (!response.ok) throw new Error('Conversion failed');

    const disposition = response.headers.get('Content-Disposition');
    let downloadName = fileInput.files[0].name;
    if (disposition) {
      const match = disposition.match(/filename[^;=\n]*=((['"])(.+?)\2|([^;\n]*))/);
      if (match) downloadName = (match[3] || match[4] || downloadName).trim();
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = downloadName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    loading.classList.add('hidden');
    successMsg.classList.remove('hidden');
  } catch {
    loading.classList.add('hidden');
    errorMsg.classList.remove('hidden');
  }

  submitBtn.disabled = false;
});
