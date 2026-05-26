import type { ApiResponse } from '../types';

export interface SplitGroup {
  id: string;
  creatorId: string;
  title: string;
  description?: string;
  totalAmount: number;
  currency: string;
  splitType: 'equal' | 'custom' | 'percentage';
  status: 'active' | 'settled' | 'cancelled';
  createdAt: string;
}

export interface SplitShare {
  id: string;
  groupId: string;
  userId?: string;
  userPhone?: string;
  userName: string;
  amount: number;
  status: 'pending' | 'paid' | 'declined';
  paidAt?: string;
}

export interface CreateSplitRequest {
  title: string;
  description?: string;
  totalAmount: number;
  currency: string;
  splitType: 'equal' | 'custom' | 'percentage';
  participants: {
    userId?: string;
    userPhone?: string;
    userName: string;
    amount?: number;
    percentage?: number;
  }[];
}

export interface SplitDetail {
  group: SplitGroup;
  shares: SplitShare[];
}

export interface ISplitPayRepository {
  createSplit(request: CreateSplitRequest): Promise<ApiResponse<SplitDetail>>;
  listSplits(): Promise<ApiResponse<SplitGroup[]>>;
  getSplit(groupId: string): Promise<ApiResponse<SplitDetail>>;
  payShare(groupId: string): Promise<ApiResponse<void>>;
  declineShare(groupId: string): Promise<ApiResponse<void>>;
  cancelSplit(groupId: string): Promise<ApiResponse<void>>;
}
