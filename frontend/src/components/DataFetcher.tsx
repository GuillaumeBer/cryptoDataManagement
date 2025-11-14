import { useInitialFetch, useIncrementalFetch } from '../hooks/useApi';

export default function DataFetcher() {
  const initialFetch = useInitialFetch();
  const incrementalFetch = useIncrementalFetch();

  const handleInitialFetch = () => {
    initialFetch.mutate();
  };

  const handleIncrementalFetch = () => {
    incrementalFetch.mutate();
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Data Management</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Initial Fetch */}
        <div className="border border-gray-200 rounded-lg p-4">
          <h3 className="font-medium text-gray-900 mb-2">Initial Fetch</h3>
          <p className="text-sm text-gray-600 mb-4">
            Fetch all assets and their full funding history (last 480 hours)
          </p>
          <button
            onClick={handleInitialFetch}
            disabled={initialFetch.isPending}
            className="w-full bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            {initialFetch.isPending ? 'Fetching...' : 'Fetch Initial Data'}
          </button>

          {initialFetch.isSuccess && (
            <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded">
              <p className="text-sm text-green-800">
                ✓ Fetched {initialFetch.data.recordsFetched} records from{' '}
                {initialFetch.data.assetsProcessed} assets
              </p>
              {initialFetch.data.errors.length > 0 && (
                <p className="text-xs text-orange-600 mt-1">
                  {initialFetch.data.errors.length} errors occurred
                </p>
              )}
            </div>
          )}

          {initialFetch.isError && (
            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded">
              <p className="text-sm text-red-800">
                ✗ Failed to fetch data
              </p>
            </div>
          )}
        </div>

        {/* Incremental Fetch */}
        <div className="border border-gray-200 rounded-lg p-4">
          <h3 className="font-medium text-gray-900 mb-2">Incremental Update</h3>
          <p className="text-sm text-gray-600 mb-4">
            Fetch only new funding rates since the last update
          </p>
          <button
            onClick={handleIncrementalFetch}
            disabled={incrementalFetch.isPending}
            className="w-full bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            {incrementalFetch.isPending ? 'Updating...' : 'Update Data'}
          </button>

          {incrementalFetch.isSuccess && (
            <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded">
              <p className="text-sm text-green-800">
                ✓ Fetched {incrementalFetch.data.recordsFetched} new records from{' '}
                {incrementalFetch.data.assetsProcessed} assets
              </p>
            </div>
          )}

          {incrementalFetch.isError && (
            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded">
              <p className="text-sm text-red-800">
                ✗ Failed to update data
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
