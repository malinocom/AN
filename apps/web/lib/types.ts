export type User = { id: string; username: 'Amir' | 'Nazi' };
export type Peer = { username: 'Amir' | 'Nazi'; last_seen_at: number | null };
export type SessionResponse = { user: User; peer: Peer | null };

export type ChatMessage = {
  id: string;
  senderId: string;
  senderName: 'Amir' | 'Nazi';
  text: string | null;
  messageType: 'text' | 'image' | 'video';
  mediaId: string | null;
  media: null | { id: string; kind: 'image' | 'video'; mimeType: string; size: number; hasThumbnail: boolean };
  replyTo: null | { id: string; text: string | null; messageType: string; senderName: string | null };
  clientMessageId: string;
  status: 'sent' | 'deleted' | 'sending' | 'failed';
  createdAt: number;
  updatedAt: number | null;
  deletedAt: number | null;
  readByPeer: boolean;
  heartByMe: boolean;
  heartByPeer: boolean;
  localError?: string;
};

export type MessagePage = {
  messages: ChatMessage[];
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
  oldestCursor: string | null;
  newestCursor: string | null;
};
