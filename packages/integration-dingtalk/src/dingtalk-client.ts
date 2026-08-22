import { DWClient, TOPIC_ROBOT, type DWClientDownStream } from "dingtalk-stream";

export interface DingTalkMessage {
  headers: { messageId: string };
  data: string;
}

export interface DingTalkClient {
  onRobotMessage(callback: (message: DingTalkMessage) => void | Promise<void>): void;
  connect(): Promise<void>;
  disconnect(): void;
  acknowledge(messageId: string): void;
}

export interface DingTalkClientFactory {
  create(clientId: string, clientSecret: string): DingTalkClient;
}

export class OfficialDingTalkClientFactory implements DingTalkClientFactory {
  create(clientId: string, clientSecret: string): DingTalkClient {
    return new OfficialDingTalkClient(new DWClient({ clientId, clientSecret, keepAlive: true }));
  }
}

class OfficialDingTalkClient implements DingTalkClient {
  constructor(private readonly client: DWClient) {}

  onRobotMessage(callback: (message: DingTalkMessage) => void | Promise<void>): void {
    this.client.registerCallbackListener(TOPIC_ROBOT, (message: DWClientDownStream) => {
      void callback({ headers: { messageId: message.headers.messageId }, data: message.data });
    });
  }

  connect(): Promise<void> {
    return this.client.connect();
  }

  disconnect(): void {
    this.client.disconnect();
  }

  acknowledge(messageId: string): void {
    this.client.socketCallBackResponse(messageId, { success: true });
  }
}
