import * as React from "react";

export default function App() {
    const [socket] = React.useState("ws://localhost:8787/websocket");

    const ws = React.useRef<WebSocket | null>(null);

    React.useEffect(() => {
        ws.current = new WebSocket(socket);

        ws.current.addEventListener("open", () => {
            console.log("connected: ", socket);
        });

        ws.current.addEventListener("message", e => {
            console.log(e.data);
        });

        return () => {
            ws.current.removeEventListener("open", () => {
                console.log("removed: open event");
            });

            ws.current.removeEventListener("message", () => {
                console.log("removed: message");
            });
        };
    });

    function send() {
        ws.current.send("ping");
    }

    return (
        <div>
            <h1>Conference</h1>
            <button onClick={send}>send</button>
        </div>
    );
}
