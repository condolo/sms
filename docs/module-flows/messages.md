# Messages

## Send and manage a message

1. Open **Messages** and choose **Compose**.
2. Select a permitted recipient or audience, enter the subject and message, and verify the audience before sending.
3. Send the message, then use the inbox to read replies and mark messages as needed.
4. Delete your own message only when appropriate. Moderating another person's message requires the moderation permission.

Messages are school-scoped, but group audiences can reach many people. Avoid including sensitive student or staff data unless the recipient list is necessary and authorized. Notifications are system-generated and differ from manually composed messages.


## Setup, updates, and verification

### Maintain audiences and message history

Before sending, verify recipients, class/group, and message content, especially when using a large audience. Send a test to an authorized colleague for high-impact or time-sensitive notices. Use the sent/inbox history to confirm delivery state where available. Edit or delete only through the message actions your role permits; use moderation authority for another user's content and keep sensitive student details out of broad messages.

**Access:** Messages permissions govern view, send, own-message deletion, and moderation separately.

**Sources:** `client/src/pages/messages/MessagesPage.jsx`; `server/routes/messages.js`; [User Guide](../USER_GUIDE.md#11-communication).; [CHANGELOG.md](../../CHANGELOG.md)

**Recent change notes:** always check [CHANGELOG.md](../../CHANGELOG.md) before sending or changing audience guidance. v5.191.0 added parent-to-school messaging with recipient categories; parents must not be able to address another parent through the school messaging flow. Verify the selected recipient category and audience before sending.
