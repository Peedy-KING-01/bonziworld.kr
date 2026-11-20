// Voice chat: WebRTC mesh between users in the same room. The server relays
// signaling only (vc:join, vc:leave, vc:signal); audio goes peer to peer.
(() => {
    const ICE = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }] };
    const peers = new Map(); // guid -> { pc, audio }
    let stream = null;
    let active = false;

    const btn = document.createElement("div");
    btn.id = "btn_voice";
    btn.className = "tray_btn";
    btn.textContent = "\u{1F3A4}";
    btn.title = "Voice chat (click to join/leave)";
    document.getElementById("chat_tray").appendChild(btn);

    function closePeer(guid) {
        const p = peers.get(guid);
        if (!p) return;
        p.pc.close();
        p.audio.srcObject = null;
        p.audio.remove();
        peers.delete(guid);
    }

    function createPeer(guid) {
        closePeer(guid);
        const pc = new RTCPeerConnection(ICE);
        const audio = document.createElement("audio");
        audio.autoplay = true;
        document.body.appendChild(audio);
        for (const track of stream.getTracks()) pc.addTrack(track, stream);
        pc.ontrack = (e) => {
            audio.srcObject = e.streams[0];
            audio.play().catch(() => {});
        };
        pc.onicecandidate = (e) => {
            if (e.candidate) socket.emit("vc:signal", { to: guid, data: { candidate: e.candidate } });
        };
        pc.onconnectionstatechange = () => {
            if (pc.connectionState === "failed" || pc.connectionState === "closed") closePeer(guid);
        };
        const p = { pc, audio };
        peers.set(guid, p);
        return p;
    }

    async function start() {
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true },
            });
        } catch (err) {
            alert("Could not access your microphone: " + (err.message || err.name));
            return;
        }
        active = true;
        btn.classList.add("on");
        socket.emit("vc:join");
    }

    function stop() {
        active = false;
        btn.classList.remove("on");
        socket.emit("vc:leave");
        for (const guid of [...peers.keys()]) closePeer(guid);
        if (stream) stream.getTracks().forEach((t) => t.stop());
        stream = null;
    }

    btn.onclick = () => (active ? stop() : start());

    // Existing voice members; we are the newcomer, so we send the offers.
    socket.on("vc:peers", async (guids) => {
        if (!active) return;
        for (const guid of guids) {
            const { pc } = createPeer(guid);
            await pc.setLocalDescription(await pc.createOffer());
            socket.emit("vc:signal", { to: guid, data: { sdp: pc.localDescription } });
        }
    });

    socket.on("vc:signal", async ({ from, data }) => {
        if (!active || !data) return;
        try {
            if (data.sdp) {
                let p = peers.get(from);
                if (data.sdp.type === "offer") {
                    p = createPeer(from);
                    await p.pc.setRemoteDescription(data.sdp);
                    await p.pc.setLocalDescription(await p.pc.createAnswer());
                    socket.emit("vc:signal", { to: from, data: { sdp: p.pc.localDescription } });
                } else if (p) {
                    await p.pc.setRemoteDescription(data.sdp);
                }
            } else if (data.candidate) {
                const p = peers.get(from);
                if (p) await p.pc.addIceCandidate(data.candidate);
            }
        } catch (err) {
            console.warn("voice chat signaling error", err);
        }
    });

    socket.on("vc:left", closePeer);
    socket.on("disconnect", () => { if (active) stop(); });
})();
