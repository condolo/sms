window.onerror = function(msg, src, line, col, err) {
  document.getElementById('pre-react-error').style.display = 'block';
  document.getElementById('pre-react-error-msg').textContent = (err && err.stack) || msg;
};
window.onunhandledrejection = function(e) {
  document.getElementById('pre-react-error').style.display = 'block';
  document.getElementById('pre-react-error-msg').textContent = String(e.reason);
};
