chrome.storage.sync.get({ server: "http://localhost:3000", token: "" }).then(({ server, token }) => {
  document.getElementById("s").value = server; document.getElementById("k").value = token;
});
document.getElementById("save").onclick = async () => {
  await chrome.storage.sync.set({ server: document.getElementById("s").value.trim(), token: document.getElementById("k").value.trim() });
  document.getElementById("msg").textContent = "Saved";
};
