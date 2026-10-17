# LibreQoS sa Proxmox, CCR1036 sa labas

Ito ang wiring. Ang CCR1036 lang ang nasa labas ng Proxmox. Ang LibreQoS, PPPoE, at hotspot ay VM.

```
ISP
 |
CCR1036                         physical core, hindi VM
 |  SFP+  papunta sa Proxmox
 |
LibreQoS VM                     Linux bridge, walang IP sa dalawang shaping NIC
 |  10G SFP
 |
10G SFP switch                  L2 lang, hindi ito humuhubog
 |                 |
PPPoE VM          Hotspot VM
ISP-in            ISP-in
```

Download ng subscriber: ISP → CCR1036 → LibreQoS → 10G switch → ISP-in ng PPPoE o hotspot VM → subscriber.

Upload: subscriber → VM → switch → LibreQoS → CCR1036 → ISP.

Sa LibreQoS 2.2, `to_internet` ang NIC na nakaharap sa CCR1036. `to_network` ang 10G SFP na nakaharap sa switch.

## Bakit ganito

LibreQoS humuhubog ng IP na nakikita niya sa bridge. Ang bawat PPPoE `/32` at hotspot client IP dapat dumaan doon nang hindi pa na-NAT.

Ang NAT ay nasa CCR1036, sa port niya papunta sa ISP. Ang PPPoE VM at hotspot VM nagro-route lang. Kapag na-NAT na sa VM bago tumawid sa LibreQoS, isang IP lang ang makikita ng shaper at hindi mahuhubog ang bawat subscriber.

## Mga NIC sa Proxmox host

Apat na hiwalay na port. Huwag pagsamahin sa iisang vmbr ang dalawang gilid ng LibreQoS. Kapag pinagsama ng Proxmox ang CCR side at ang switch side, dumadaan ang traffic sa host at nilalampasan ang shaper.

| Port sa host | Bridge | VM | Role |
| --- | --- | --- | --- |
| Management | `vmbr0` | LibreQoS `net0` | WebUI at API. May IP. |
| Papunta sa CCR1036 SFP+ | `vmbr1` | LibreQoS `net1` | `to_internet` |
| 10G SFP papunta sa switch | `vmbr2` | LibreQoS `net2` | `to_network` |
| Balik mula sa switch | `vmbr3` | PPPoE at hotspot ISP-in | WAN ng dalawang MikroTik VM |

`vmbr1` walang ibang VM. `vmbr2` walang ibang VM. `vmbr3` lang ang hinahatian ng PPPoE at hotspot.

Sa bawat shaping vNIC: virtio, multiqueue katumbas ng bilang ng vCPU. CPU type ng VM: `host`. Linux bridge ang mode sa LibreQoS 2.2, hindi Bifrost. Iyan ang inirerekomenda para sa VM. Kapag kailangan ang buong 10 Gbps, i-passthrough ang dalawang shaping NIC sa VM sa halip na virtio.

Halimbawa ng guest interfaces: `ens18` management, `ens19` harap sa CCR, `ens20` ang 10G. Walang address sa `ens19` at `ens20`. Ang first-run page ang magtatakda: `to_internet = ens19`, `to_network = ens20`.

## Switch

Untagged, iisang VLAN, sa tatlong port lang:

1. Galing sa Proxmox 10G SFP (LibreQoS `to_network`)
2. Balik sa Proxmox port ng `vmbr3`
3. Walang direct cable mula sa CCR1036 papunta sa switch

Ang ikatlong patakaran ang bypass. Kapag may cable mula sa CCR diretso sa switch, buhay ang internet pero patay ang shaping.

## Mga IP

Transit sa bridge, halimbawa:

| Device | Address | Interface |
| --- | --- | --- |
| CCR1036 | `10.255.0.1/24` | port papunta sa LibreQoS |
| PPPoE VM | `10.255.0.2/24` | ISP-in |
| Hotspot VM | `10.255.0.3/24` | ISP-in |
| LibreQoS ens19 / ens20 | walang IP | shaping bridge |

Subscriber pools, halimbawa `100.64.0.0/16` sa PPPoE at `100.70.0.0/16` sa hotspot:

- Sa PPPoE at hotspot VM: route ang pool palabas sa ISP-in. Walang masquerade sa ISP-in.
- Sa CCR1036: route ang dalawang pool papunta sa `10.255.0.2` at `10.255.0.3`. Src-NAT lang sa tunay na ISP port.

Ang mga IP na iyon ang laman ng `ShapedDevices.csv`. Ang JM bridge sa billing VPS ang magpu-push ng listahan sa API ng LibreQoS VM (`tcp/9122` sa management IP).

## VM size

LibreQoS VM: 4 vCPU, 8 GB RAM, disk 32 GB. PPPoE at hotspot manatili sa sarili nilang VM, may hiwalay na LAN port papunta sa mga access site. Ang LAN na iyon ay hindi dadaan sa `vmbr1` o `vmbr2`.
