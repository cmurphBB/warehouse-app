ALTER TABLE `parts` ADD COLUMN `department` text DEFAULT 'Other' NOT NULL;
--> statement-breakpoint
UPDATE `parts` SET `department` = 'Pipe & Tubing' WHERE `category` IN ('Black Nips','Brass Nips','Pex Pipe','Pipe & Tubing','Smoke Pipe');
--> statement-breakpoint
UPDATE `parts` SET `department` = 'Fittings' WHERE `category` IN ('BM','Brass','Brass / Refrigeration','Mega','Nylon','PVC','PVC / Refrigeration','PVC — 1738 Vent Fittings','Pex','Plug','Propress','Push','Sweat','Test Cap','Fittings');
--> statement-breakpoint
UPDATE `parts` SET `department` = 'Valves' WHERE `category` IN ('Ball Valve','Gas Cock','Gas Flex','Mixing Valve','Stop','Valves');
--> statement-breakpoint
UPDATE `parts` SET `department` = 'HVAC Parts' WHERE `category` IN ('Boiler','Boiler / Thermo','Condensate','Contactor','Gauge','HVAC','Hydro','Navien','Refrigeration','Tank','Thermo','Transformer');
--> statement-breakpoint
UPDATE `parts` SET `department` = 'Fixtures & Trim' WHERE `category` IN ('Disposal','Faucet','Lavatory','Sill','Toilet','Toilet, Faucet, Lavatory','Tub & Shower');
--> statement-breakpoint
UPDATE `parts` SET `department` = 'Pumps, Filters & Water' WHERE `category` IN ('Filters','Liberty 331 / M18','Maintenance','Pump','Water Test');
--> statement-breakpoint
UPDATE `parts` SET `department` = 'Electrical & Controls' WHERE `category` IN ('Alarm','Battery','Electrical','Electrical / Thermo');
--> statement-breakpoint
UPDATE `parts` SET `department` = 'Hardware & Hangers' WHERE `category` IN ('Hangers, Clips & Clamps','Hangers, Clips & Clamps / Pipe & Tubing','Hardware');
--> statement-breakpoint
UPDATE `parts` SET `department` = 'Consumables & Safety' WHERE `category` IN ('Consumables','Consumables / Hand Tool / Hardware','Consumables / Hardware','Consumables / Safety','Safety','Tools/Consumables');
