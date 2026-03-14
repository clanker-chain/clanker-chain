# mqtt-node-client

Thin MQTT client for clanker-chain bots. Connect with a JWT password (from identity_issue_mqtt_token), publish/subscribe using the topic layout in bot-comms.md, and poll for received messages.

## Usage

```js
import { MqttClient, topicForInbox, topicForAnnounce } from "mqtt-node-client";
import { IdentityClient } from "identity-node-client";

const identity = new IdentityClient({ botId: "openclaw.france.prod-1", operatorId: "org.openclaw.pat" });
const mqtt = new MqttClient();

await mqtt.connect({
  brokerUrl: "mqtt://localhost:1883",
  clientId: "openclaw.france.prod-1",
  getPassword: () => identity.issueMqttToken(300),
});

await mqtt.subscribe(["bots/france-bot/inbox", "bots/all/announce"]);
mqtt.publishToInbox("tooter-bot", { type: "coordination", body: { action: "ping" } });
const messages = await mqtt.poll(500);
await mqtt.disconnect();
```

## API

- `connect(options)` — options: brokerUrl, clientId, getPassword (async), optional username.
- `publish(topic, payload, { qos, retain })`
- `publishToInbox(toBotName, envelope)`, `publishAnnounce(envelope)`
- `subscribe(topics[])`, `unsubscribe(topics[])`
- `poll(timeoutMs)` — returns received messages since last poll; waits up to timeoutMs if buffer empty.
- `disconnect()`
- Helpers: `topicForInbox(botName)`, `topicForAnnounce()`, `topicForDmCoordination(bot1, bot2)`, `topicForStatus(botName)`
