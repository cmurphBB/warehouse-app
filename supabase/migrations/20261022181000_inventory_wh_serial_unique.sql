-- One record per consigned water heater serial (case-insensitive), so a double-tap
-- or two iPads can't receive the same unit twice.
create unique index if not exists equipment_consigned_wh_serial_uq
  on inventory.equipment (upper(serial_number))
  where is_consigned = 1 and serial_number <> '' and category = 'Water Heater';
