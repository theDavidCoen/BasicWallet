package app.basic.wallet

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.content.Context
import android.os.Build
import android.os.ParcelUuid
import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Minimal BLE GATT peripheral for Basic Wallet fast login.
 * Device 2 (onboarding) hosts the server; Device 1 connects as central and writes ciphertext.
 */
class PairGattServerModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  companion object {
    const val NAME = "BasicPairGattServer"

    val SERVICE_UUID: UUID = UUID.fromString("ba51c001-0000-4000-8000-00805f9b34fb")
    val LOBBY_UUID: UUID = UUID.fromString("ba51c001-0001-4000-8000-00805f9b34fb")
    val CIPHER_UUID: UUID = UUID.fromString("ba51c001-0002-4000-8000-00805f9b34fb")
    val ACK_UUID: UUID = UUID.fromString("ba51c001-0003-4000-8000-00805f9b34fb")
    val CCCD_UUID: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
  }

  private var gattServer: BluetoothGattServer? = null
  private var advertiser: BluetoothLeAdvertiser? = null
  private var advertising = false
  private var lobbyValue: ByteArray = ByteArray(0)
  private val subscribedDevices = ConcurrentHashMap.newKeySet<BluetoothDevice>()
  private var connectedDevice: BluetoothDevice? = null

  override fun getName(): String = NAME

  private fun emit(event: String, params: WritableMap?) {
    if (!reactContext.hasActiveReactInstance()) return
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(event, params)
  }

  private fun bluetoothManager(): BluetoothManager? =
    reactContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager

  private fun adapter(): BluetoothAdapter? = bluetoothManager()?.adapter

  @ReactMethod
  fun addListener(eventName: String) {
    /* RN NativeEventEmitter requirement */
  }

  @ReactMethod
  fun removeListeners(count: Int) {
    /* RN NativeEventEmitter requirement */
  }

  @SuppressLint("MissingPermission")
  @ReactMethod
  fun startServer(lobbyValueBase64: String, promise: Promise) {
    try {
      stopInternal()
      val mgr = bluetoothManager()
      val adapter = adapter()
      if (mgr == null || adapter == null || !adapter.isEnabled) {
        promise.reject("BT_OFF", "Bluetooth is off or unavailable")
        return
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        // Permissions are requested from JS; still guard.
      }
      lobbyValue = Base64.decode(lobbyValueBase64, Base64.DEFAULT)
      if (lobbyValue.isEmpty()) {
        promise.reject("BAD_LOBBY", "Lobby value is empty")
        return
      }

      gattServer = mgr.openGattServer(reactContext, gattCallback)
      val server = gattServer
      if (server == null) {
        promise.reject("GATT_OPEN", "Could not open GATT server")
        return
      }

      val service = BluetoothGattService(SERVICE_UUID, BluetoothGattService.SERVICE_TYPE_PRIMARY)

      val lobby =
        BluetoothGattCharacteristic(
          LOBBY_UUID,
          BluetoothGattCharacteristic.PROPERTY_READ,
          BluetoothGattCharacteristic.PERMISSION_READ,
        )
      lobby.value = lobbyValue

      val cipher =
        BluetoothGattCharacteristic(
          CIPHER_UUID,
          BluetoothGattCharacteristic.PROPERTY_WRITE or
            BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE,
          BluetoothGattCharacteristic.PERMISSION_WRITE,
        )

      val ack =
        BluetoothGattCharacteristic(
          ACK_UUID,
          BluetoothGattCharacteristic.PROPERTY_READ or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
          BluetoothGattCharacteristic.PERMISSION_READ,
        )
      ack.value = byteArrayOf(0)
      val cccd =
        BluetoothGattDescriptor(
          CCCD_UUID,
          BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE,
        )
      cccd.value = BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE
      ack.addDescriptor(cccd)

      service.addCharacteristic(lobby)
      service.addCharacteristic(cipher)
      service.addCharacteristic(ack)
      server.addService(service)

      advertiser = adapter.bluetoothLeAdvertiser
      val adv = advertiser
      if (adv == null) {
        stopInternal()
        promise.reject("NO_ADV", "BLE advertiser unavailable")
        return
      }

      val settings =
        AdvertiseSettings.Builder()
          .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
          .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
          .setConnectable(true)
          .setTimeout(0)
          .build()

      val data =
        AdvertiseData.Builder()
          .setIncludeDeviceName(false)
          .setIncludeTxPowerLevel(false)
          .addServiceUuid(ParcelUuid(SERVICE_UUID))
          .build()

      adv.startAdvertising(settings, data, advertiseCallback)
      advertising = true
      promise.resolve(true)
    } catch (e: Exception) {
      stopInternal()
      promise.reject("START_FAIL", e.message, e)
    }
  }

  @SuppressLint("MissingPermission")
  @ReactMethod
  fun sendAck(ok: Boolean, message: String?, promise: Promise) {
    try {
      val server = gattServer
      val device = connectedDevice
      if (server == null || device == null) {
        promise.reject("NO_CENTRAL", "No connected central to notify")
        return
      }
      val service = server.getService(SERVICE_UUID)
      val ack = service?.getCharacteristic(ACK_UUID)
      if (ack == null) {
        promise.reject("NO_ACK", "ACK characteristic missing")
        return
      }
      val msgBytes = (message ?: "").toByteArray(Charsets.UTF_8)
      val payload = ByteArray(1 + msgBytes.size)
      payload[0] = if (ok) 0x01 else 0x02
      System.arraycopy(msgBytes, 0, payload, 1, msgBytes.size)
      val notified =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          server.notifyCharacteristicChanged(device, ack, false, payload)
        } else {
          @Suppress("DEPRECATION")
          run {
            ack.value = payload
            server.notifyCharacteristicChanged(device, ack, false)
          }
        }
      promise.resolve(notified)
    } catch (e: Exception) {
      promise.reject("ACK_FAIL", e.message, e)
    }
  }

  @SuppressLint("MissingPermission")
  @ReactMethod
  fun stopServer(promise: Promise) {
    try {
      stopInternal()
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("STOP_FAIL", e.message, e)
    }
  }

  @SuppressLint("MissingPermission")
  private fun stopInternal() {
    try {
      if (advertising) {
        advertiser?.stopAdvertising(advertiseCallback)
      }
    } catch (_: Exception) {
    }
    advertising = false
    advertiser = null
    subscribedDevices.clear()
    connectedDevice = null
    try {
      gattServer?.close()
    } catch (_: Exception) {
    }
    gattServer = null
  }

  private val advertiseCallback =
    object : AdvertiseCallback() {
      override fun onStartSuccess(settingsInEffect: AdvertiseSettings) {
        val map = Arguments.createMap()
        map.putBoolean("advertising", true)
        emit("BasicPairGatt_onAdvertising", map)
      }

      override fun onStartFailure(errorCode: Int) {
        val map = Arguments.createMap()
        map.putInt("errorCode", errorCode)
        emit("BasicPairGatt_onAdvertiseError", map)
      }
    }

  private val gattCallback =
    object : BluetoothGattServerCallback() {
      @SuppressLint("MissingPermission")
      override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
        if (newState == BluetoothProfile.STATE_CONNECTED) {
          connectedDevice = device
          val map = Arguments.createMap()
          map.putString("address", device.address)
          emit("BasicPairGatt_onConnected", map)
        } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
          if (connectedDevice?.address == device.address) {
            connectedDevice = null
          }
          subscribedDevices.remove(device)
          val map = Arguments.createMap()
          map.putString("address", device.address)
          emit("BasicPairGatt_onDisconnected", map)
        }
      }

      @SuppressLint("MissingPermission")
      override fun onCharacteristicReadRequest(
        device: BluetoothDevice,
        requestId: Int,
        offset: Int,
        characteristic: BluetoothGattCharacteristic,
      ) {
        val server = gattServer ?: return
        val value =
          when (characteristic.uuid) {
            LOBBY_UUID -> lobbyValue
            ACK_UUID -> characteristic.value ?: byteArrayOf(0)
            else -> null
          }
        if (value == null) {
          server.sendResponse(device, requestId, BluetoothGatt.GATT_FAILURE, offset, null)
          return
        }
        if (offset > value.size) {
          server.sendResponse(device, requestId, BluetoothGatt.GATT_INVALID_OFFSET, offset, null)
          return
        }
        val slice = value.copyOfRange(offset, value.size)
        server.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, slice)
      }

      @SuppressLint("MissingPermission")
      override fun onCharacteristicWriteRequest(
        device: BluetoothDevice,
        requestId: Int,
        characteristic: BluetoothGattCharacteristic,
        preparedWrite: Boolean,
        responseNeeded: Boolean,
        offset: Int,
        value: ByteArray?,
      ) {
        val server = gattServer ?: return
        if (characteristic.uuid != CIPHER_UUID || value == null) {
          if (responseNeeded) {
            server.sendResponse(device, requestId, BluetoothGatt.GATT_FAILURE, offset, null)
          }
          return
        }
        if (responseNeeded) {
          server.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value)
        }
        val map = Arguments.createMap()
        map.putString("address", device.address)
        map.putString("dataBase64", Base64.encodeToString(value, Base64.NO_WRAP))
        emit("BasicPairGatt_onCipherWrite", map)
      }

      @SuppressLint("MissingPermission")
      override fun onDescriptorWriteRequest(
        device: BluetoothDevice,
        requestId: Int,
        descriptor: BluetoothGattDescriptor,
        preparedWrite: Boolean,
        responseNeeded: Boolean,
        offset: Int,
        value: ByteArray?,
      ) {
        val server = gattServer ?: return
        if (descriptor.uuid == CCCD_UUID && value != null) {
          descriptor.value = value
          val enable =
            value.contentEquals(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE) ||
              value.contentEquals(BluetoothGattDescriptor.ENABLE_INDICATION_VALUE)
          if (enable) subscribedDevices.add(device) else subscribedDevices.remove(device)
          if (responseNeeded) {
            server.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value)
          }
          return
        }
        if (responseNeeded) {
          server.sendResponse(device, requestId, BluetoothGatt.GATT_FAILURE, offset, null)
        }
      }

      override fun onMtuChanged(device: BluetoothDevice, mtu: Int) {
        val map = Arguments.createMap()
        map.putString("address", device.address)
        map.putInt("mtu", mtu)
        emit("BasicPairGatt_onMtuChanged", map)
      }
    }
}
