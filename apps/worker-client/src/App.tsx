import * as React from "react";

export default function App() {
    const [wsURI, setWSURI] = React.useState("");
    const [msg, setMsg] = React.useState("");

    async function openMediaConstrains(constraints: MediaStreamConstraints) {
        return await navigator.mediaDevices.getUserMedia(constraints);
    }

    const socket = React.useMemo(() => {
        return new WebSocket(wsURI);
    }, [wsURI]);

    React.useEffect(() => {
        socket.addEventListener("open", () => {
            console.log("connected");
            openMediaConstrains({ video: true, audio: { echoCancellation: true } });
        });

        socket.addEventListener("message", e => {
            console.log(e.data);
        });

        return () => {
            socket.removeEventListener("open", () => {
                console.log("removed eventListener: open");
            });

            socket.removeEventListener("message", () => {
                console.log("removed eventListener: message");
            });
        };
    }, [socket]);

    function sendMsg() {
        socket.send("ping");
    }

    return (
        <div>
            <h1>video conferencing app</h1>
            <input type="text" name="wsURI" id="wsURI" value={wsURI} onChange={e => setWSURI(e.currentTarget.value)} />
            {/* <button onClick={() => join(wsURI)}>join</button> */}

            <br />

            <input type="text" name="msg" id="msg" value={msg} onChange={e => setMsg(e.currentTarget.value)} />
            <button onClick={sendMsg}>send</button>
        </div>
    );
}
