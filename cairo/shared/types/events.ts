export interface BaseEvent {
  id: string;
  type: string;
  timestamp: string;
  correlation_id?: string;
}

export interface WakeWordDetectedEvent extends BaseEvent {
  type: 'wake_word.detected';
  data: {
    confidence: number;
  };
}

export interface SpeechFinalEvent extends BaseEvent {
  type: 'speech.final';
  data: {
    text: string;
    user_id: string;
    confidence: number;
  };
}

export interface ToolRequestEvent extends BaseEvent {
  type: 'tool.request';
  data: {
    request_id: string;
    tool: string;
    args: any;
  };
}

export interface ToolResultEvent extends BaseEvent {
  type: 'tool.result';
  data: {
    request_id: string;
    result: any;
  };
}

export type CairoEvent =
  | WakeWordDetectedEvent
  | SpeechFinalEvent
  | ToolRequestEvent
  | ToolResultEvent;

export type EventType = CairoEvent['type'];
