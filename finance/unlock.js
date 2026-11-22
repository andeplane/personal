const form = document.getElementById("unlock-form");
const input = document.getElementById("password");
const button = document.getElementById("unlock");
const status = document.getElementById("unlock-status");
button.disabled = false;

form.addEventListener("submit", async event => {
  event.preventDefault();
  if (button.disabled) return;
  button.disabled = true;
  status.textContent = "Unlocking…";
  const password = input.value;
  input.value = "";
  try {
    const response = await fetch("ledger.enc");
    if (!response.ok) throw new Error("The encrypted ledger could not be loaded. Try again.");
    const bytes = new Uint8Array(await response.arrayBuffer());
    const material = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]
    );
    const key = await crypto.subtle.deriveKey(
      {name: "PBKDF2", salt: bytes.subarray(0, 16), iterations: 600000, hash: "SHA-256"},
      material, {name: "AES-GCM", length: 256}, false, ["decrypt"]
    );
    const plain = await crypto.subtle.decrypt({name: "AES-GCM", iv: bytes.subarray(16, 28)}, key, bytes.subarray(28));
    window.FINANCE_DATA = JSON.parse(new TextDecoder().decode(plain));
    await import("./app.js");
    document.getElementById("gate").hidden = true;
    document.getElementById("finance-app").hidden = false;
    document.getElementById("lock").focus();
  } catch (error) {
    status.textContent = error.name === "OperationError"
      ? "Couldn’t unlock the ledger. Check the password and try again."
      : "Couldn’t load the finance overview. Reload the page and try again.";
    input.focus();
  } finally {
    button.disabled = false;
  }
});
document.getElementById("lock").addEventListener("click", () => location.reload());
window.addEventListener("pageshow", event => {
  if (event.persisted) location.reload();
});
