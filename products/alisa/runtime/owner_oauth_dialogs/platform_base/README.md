Historical exact installed LEGACY_STATION_ONLY inputs, not active code.

Source 3f2527482db8fd7edb240258fae814d38adc0f4f; two files total15610bytes. These match the installed platform485a2034 minimal variant. Retained only so shallow CI can reproduce the old schema and a minimal views delta without fetching historical refs or introducing a live migration. oauth.py is unchanged in the current branch and separately pinned by compose.platform_sources. No credentials or user data.

{
  "models.py": "008ed4876fd87c8bf4bf22061c64740ab8a0aa37ee77cace40786d9122d4bc3c",
  "views.py": "c6d539f6e153a0e41a69a747265b13237c52244ad864895120b14eb5f502aa47"
}
