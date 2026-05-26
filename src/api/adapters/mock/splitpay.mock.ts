import type {
  ISplitPayRepository,
  SplitGroup,
  SplitShare,
  SplitDetail,
  CreateSplitRequest,
} from '../../repositories/splitpay.repository';
import type { ApiResponse } from '../../types';
import { apiSuccess, apiError } from '../../types';

const STORAGE_KEY = 'kiramopay_app_state';

function getState() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

function saveField(field: string, value: unknown) {
  const state = getState() || {};
  state[field] = value;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export class MockSplitPayRepository implements ISplitPayRepository {
  async createSplit(request: CreateSplitRequest): Promise<ApiResponse<SplitDetail>> {
    const groupId = `split-${Date.now()}`;
    const group: SplitGroup = {
      id: groupId,
      creatorId: 'current-user',
      title: request.title,
      description: request.description,
      totalAmount: request.totalAmount,
      currency: request.currency,
      splitType: request.splitType,
      status: 'active',
      createdAt: new Date().toISOString(),
    };

    const equalAmount = request.totalAmount / request.participants.length;
    const shares: SplitShare[] = request.participants.map((p, i) => ({
      id: `share-${Date.now()}-${i}`,
      groupId,
      userId: p.userId,
      userPhone: p.userPhone,
      userName: p.userName,
      amount:
        request.splitType === 'equal'
          ? Math.round(equalAmount * 100) / 100
          : request.splitType === 'percentage'
            ? Math.round(request.totalAmount * ((p.percentage ?? 0) / 100) * 100) / 100
            : p.amount ?? 0,
      status: 'pending',
    }));

    const state = getState();
    const groups: SplitGroup[] = state?.splitGroups ?? [];
    const allShares: SplitShare[] = state?.splitShares ?? [];
    groups.unshift(group);
    allShares.push(...shares);
    saveField('splitGroups', groups);
    saveField('splitShares', allShares);

    return apiSuccess({ group, shares });
  }

  async listSplits(): Promise<ApiResponse<SplitGroup[]>> {
    const state = getState();
    return apiSuccess(state?.splitGroups ?? []);
  }

  async getSplit(groupId: string): Promise<ApiResponse<SplitDetail>> {
    const state = getState();
    const groups: SplitGroup[] = state?.splitGroups ?? [];
    const group = groups.find((g) => g.id === groupId);
    if (!group) return apiError('NOT_FOUND', 'Grupo no encontrado');
    const allShares: SplitShare[] = state?.splitShares ?? [];
    const shares = allShares.filter((s) => s.groupId === groupId);
    return apiSuccess({ group, shares });
  }

  async payShare(groupId: string): Promise<ApiResponse<void>> {
    const state = getState();
    const allShares: SplitShare[] = state?.splitShares ?? [];
    const idx = allShares.findIndex(
      (s) => s.groupId === groupId && s.userId === 'current-user' && s.status === 'pending',
    );
    if (idx === -1) return apiError('NOT_FOUND', 'No tienes una parte pendiente en este grupo');
    allShares[idx].status = 'paid';
    allShares[idx].paidAt = new Date().toISOString();
    saveField('splitShares', allShares);

    // Check if all shares are paid to settle the group
    const groupShares = allShares.filter((s) => s.groupId === groupId);
    if (groupShares.every((s) => s.status === 'paid')) {
      const groups: SplitGroup[] = state?.splitGroups ?? [];
      const gIdx = groups.findIndex((g) => g.id === groupId);
      if (gIdx !== -1) {
        groups[gIdx].status = 'settled';
        saveField('splitGroups', groups);
      }
    }
    return apiSuccess(undefined as unknown as void);
  }

  async declineShare(groupId: string): Promise<ApiResponse<void>> {
    const state = getState();
    const allShares: SplitShare[] = state?.splitShares ?? [];
    const idx = allShares.findIndex(
      (s) => s.groupId === groupId && s.userId === 'current-user' && s.status === 'pending',
    );
    if (idx === -1) return apiError('NOT_FOUND', 'No tienes una parte pendiente en este grupo');
    allShares[idx].status = 'declined';
    saveField('splitShares', allShares);
    return apiSuccess(undefined as unknown as void);
  }

  async cancelSplit(groupId: string): Promise<ApiResponse<void>> {
    const state = getState();
    const groups: SplitGroup[] = state?.splitGroups ?? [];
    const idx = groups.findIndex((g) => g.id === groupId);
    if (idx === -1) return apiError('NOT_FOUND', 'Grupo no encontrado');
    if (groups[idx].creatorId !== 'current-user') {
      return apiError('FORBIDDEN', 'Solo el creador puede cancelar el grupo');
    }
    groups[idx].status = 'cancelled';
    saveField('splitGroups', groups);
    return apiSuccess(undefined as unknown as void);
  }
}
