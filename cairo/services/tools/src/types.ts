export interface MCPTool {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  outputSchema?: JSONSchema;
  execute: (input: any) => Promise<any>;
  safety_level: 'read' | 'write_safe' | 'write_risky';
}

export interface JSONSchema {
  type: string;
  properties?: Record<string, any>;
  required?: string[];
  [key: string]: any;
}
