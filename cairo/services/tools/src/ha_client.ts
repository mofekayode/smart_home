import axios, { type AxiosInstance } from 'axios';

export class HomeAssistantClient {
  private client: AxiosInstance;

  constructor(baseURL: string, token: string) {
    this.client = axios.create({
      baseURL,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000  // Increased to 30 seconds for slow HA responses
    });
  }

  async getState(entityId: string): Promise<EntityState> {
    const response = await this.client.get(`/api/states/${entityId}`);
    return response.data;
  }

  async callService(
    domain: string,
    service: string,
    data?: any
  ): Promise<any> {
    const response = await this.client.post(
      `/api/services/${domain}/${service}`,
      data || {}
    );
    return response.data;
  }

  async listEntities(): Promise<EntityState[]> {
    const response = await this.client.get('/api/states');
    return response.data;
  }

  async checkConnection(): Promise<boolean> {
    try {
      const response = await this.client.get('/api/');
      return response.data.message === 'API running.';
    } catch {
      return false;
    }
  }
}

export interface EntityState {
  entity_id: string;
  state: string;
  attributes: Record<string, any>;
  last_changed: string;
  last_updated: string;
}
