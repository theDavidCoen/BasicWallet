declare module "react-native-ble-advertiser" {
  type BroadcastOptions = {
    txPowerLevel?: number;
    advertiseMode?: number;
    includeDeviceName?: boolean;
    includeTxPowerLevel?: boolean;
    connectable?: boolean;
  };
  type ScanOptions = {
    numberOfMatches?: number;
    matchMode?: number;
    scanMode?: number;
    reportDelay?: number;
  };

  interface BleAdvertiserModule {
    setCompanyId(companyId: number): void;
    broadcast(uid: string, manufData: number[], options?: BroadcastOptions): Promise<string>;
    stopBroadcast(): Promise<string>;
    scan(manufDataFilter: number[], options?: ScanOptions): Promise<string>;
    scanByService(uidFilter: string, options?: ScanOptions): Promise<string>;
    stopScan(): Promise<string>;
    enableAdapter(): void;
    disableAdapter(): void;
    getAdapterState(): Promise<string>;
    isActive(): Promise<boolean>;
    ADVERTISE_MODE_LOW_LATENCY?: number;
    ADVERTISE_MODE_BALANCED?: number;
    ADVERTISE_TX_POWER_HIGH?: number;
    SCAN_MODE_LOW_LATENCY?: number;
    MATCH_MODE_AGGRESSIVE?: number;
    MATCH_NUM_MAX_ADVERTISEMENT?: number;
  }

  const BLEAdvertiser: BleAdvertiserModule;
  export default BLEAdvertiser;
}
