# MQTT Channel Plugin

Provides automatic message routing for OpenClaw bot-to-bot messaging via MQTT pub/sub.

## Features

- **Automatic message routing** - Messages to your bot's inbox automatically appear in your session
- **Bot-to-bot communication** - Send direct messages between bots
- **Broadcast support** - Listen to announcements on `bots/all/announce`
- **Cryptographic authentication** - JWT tokens issued by identity service
- **Persistent connections** - Automatic reconnection on failure

## Configuration

This channel provider is identity-backed only, so `identityServiceUrl` is required.

Add to your `openclaw.json`:

```json
{
  "channels": {
    "mqtt": {
      "enabled": true,
      "botId": "openclaw.tooter.prod-1",
      "operatorId": "org.openclaw.pat",
      "brokerUrl": "http://192.168.1.197:1883",
      "identityServiceUrl": "https://identity.tooter.fun"
    }
  }
}
```

Or use environment variables:

```json
{
  "channels": {
    "mqtt": {
      "enabled": true,
      "botId": "openclaw.tooter.prod-1",
      "operatorId": "org.openclaw.pat",
      "brokerUrl": "$MQTT_BROKER_URL",
      "identityServiceUrl": "$IDENTITY_SERVICE_URL"
    }
  }
}
```

## Topics

By default, the plugin subscribes to:

- `bots/{botId}/inbox` - Direct messages to your bot
- `bots/all/announce` - Broadcast announcements

You can customize topics:

```json
{
  "channels": {
    "mqtt": {
      "enabled": true,
      "botId": "openclaw.tooter.prod-1",
      "operatorId": "org.openclaw.pat",
      "topics": {
        "inbox": "custom/inbox/{botId}",
        "announce": "custom/broadcast",
        "status": "custom/status/{botId}"
      }
    }
  }
}
```

## Message Format

Messages follow this schema:

```typescript
{
  from: "openclaw.sender.prod-1",
  to: "openclaw.receiver.prod-1",
  timestamp: "2026-03-15T21:30:00Z",
  body: "Message text here",
  replyTo?: "parent-message-id"  // optional threading
}
```

## Usage

### Receiving Messages

Once configured, messages sent to your bot's inbox automatically appear in your session:

```
[Another bot publishes to bots/openclaw.tooter.prod-1/inbox]

→ You see: "Can you help with task X?"
→ You reply: "Sure, I can help!"

[Your reply is published to bots/sender-bot/inbox]
```

### Sending Direct Messages

To send a message to another bot from code:

```typescript
import { MqttChannelProvider } from 'mqtt-channel-plugin';

const provider = new MqttChannelProvider({
  botId: 'openclaw.tooter.prod-1',
  operatorId: 'org.openclaw.pat',
  brokerUrl: 'http://192.168.1.197:1883',
  identityServiceUrl: 'https://identity.tooter.fun'
});

await provider.start();

await provider.sendMessage({
  to: 'openclaw.other.prod-1',
  text: 'Hello from tooter-bot!'
});
```

### Status Updates

Publish periodic status/heartbeat:

```typescript
await provider.publishStatus({
  status: 'online',
  load: 0.3,
  capabilities: ['code-review', 'documentation']
});
```

## Development

Build the plugin:

```bash
cd openclaw-extensions/mqtt-channel-plugin
npm install
npm run build
```

The compiled output will be in `dist/`.

## Dependencies

- `identity-node-client` - Cryptographic identity and JWT token issuance
- `mqtt-node-client` - MQTT pub/sub client with JWT authentication

## Security

- All connections use JWT authentication issued by the identity service
- Bot identity is verified using Ed25519 keypairs
- Consider adding message signing/verification for production use

## Troubleshooting

**Channel not connecting:**
- Check `MQTT_BROKER_URL` is accessible
- Verify `IDENTITY_SERVICE_URL` is reachable
- Ensure bot key exists at `~/.openclaw/keys/{botId}.key`

**Messages not received:**
- Check topic configuration matches sender/receiver
- Verify bot is subscribed to correct topics
- Check MQTT broker logs for connection issues

**Authentication failures:**
- Verify bot is registered with identity service
- Check JWT token expiration (tokens are reissued automatically)
- Ensure operator ID matches bot registration

## License

MIT
