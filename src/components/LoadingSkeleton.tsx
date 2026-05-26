import React from 'react';

export const LoadingSkeleton: React.FC = () => {
  return (
    <div className="p-4 space-y-4 animate-pulse" data-testid="loading-skeleton">
      {/* Header skeleton */}
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-gray-200 dark:bg-gray-700" />
        <div className="space-y-2 flex-1">
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
          <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/4" />
        </div>
      </div>

      {/* Card skeleton */}
      <div className="h-32 bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 dark:from-gray-700 dark:via-gray-600 dark:to-gray-700 rounded-2xl" />

      {/* Action buttons skeleton */}
      <div className="flex gap-3 justify-center">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex flex-col items-center gap-2">
            <div className="w-14 h-14 rounded-2xl bg-gray-200 dark:bg-gray-700" />
            <div className="h-2 w-10 bg-gray-200 dark:bg-gray-700 rounded" />
          </div>
        ))}
      </div>

      {/* List skeleton */}
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50">
            <div className="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-700" />
            <div className="flex-1 space-y-2">
              <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-2/3" />
              <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
            </div>
            <div className="h-4 w-16 bg-gray-200 dark:bg-gray-700 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
};
