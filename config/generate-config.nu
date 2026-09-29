#!/usr/bin/env nu

def get-offset [tz: string] {
  let off = (try { with-env { TZ: $tz } { ^date +%z } | str trim } catch { "+0000" })
  let num = ($off | str replace -r '^\+' '')
  try { $num | into int } catch { 0 }
}

def main [config_path: string = "/app/config/glance.yml"] {
  let cities_env = ($env.CITIES? | default "Zaragoza|Zaragoza, Spain|Europe/Madrid;Asunción|Asunción, Paraguay|America/Asuncion;Lima|Lima, Peru|America/Lima")

  let raw_cities = ($cities_env | split row ';' | str trim | filter {|c| ($c | str length) > 0 })
  let cities = ($raw_cities | each {|c|
    let parts = ($c | split row '|' | each {|p| $p | str trim })
    let name = ($parts | get 0)
    let loc = ($parts | get 1)
    let tz = ($parts | get 2)
    let offset = (get-offset $tz)
    { offset: $offset, name: $name, loc: $loc, tz: $tz }
  } | sort-by offset name)

  mut clock_lines = [
    "          - type: clock"
    "            hour-format: 24h"
    "            timezones:"
  ]
  for c in $cities {
    $clock_lines = ($clock_lines | append [
      $"              - timezone: \"($c.tz)\""
      $"                label: \"($c.name)\""
    ])
  }
  let clock_block = ($clock_lines | str join "\n")

  mut weather_lines = []
  for c in $cities {
    $weather_lines = ($weather_lines | append [
      "          - type: weather"
      $"            location: \"($c.loc)\""
      "            units: metric"
      "            hour-format: 24h"
    ])
  }
  let weather_block = ($weather_lines | str join "\n")

  let content = (open $config_path --raw)
  let clock_start = "# @CLOCK_START@"
  let clock_end = "# @CLOCK_END@"
  let weather_start = "# @WEATHER_START@"
  let weather_end = "# @WEATHER_END@"

  # Replace clock section
  let c_split = ($content | split row $clock_start)
  if ($c_split | length) == 2 {
    let before_c = ($c_split | get 0)
    let rest_c = ($c_split | get 1 | split row $clock_end)
    if ($rest_c | length) == 2 {
      let after_c = ($rest_c | get 1)
      let new_content = $"($before_c)($clock_start)\n($clock_block)\n          ($clock_end)($after_c)"

      # Replace weather section
      let w_split = ($new_content | split row $weather_start)
      if ($w_split | length) == 2 {
        let before_w = ($w_split | get 0)
        let rest_w = ($w_split | get 1 | split row $weather_end)
        if ($rest_w | length) == 2 {
          let after_w = ($rest_w | get 1)
          let final_content = $"($before_w)($weather_start)\n($weather_block)\n            ($weather_end)($after_w)"
          $final_content | save --force $config_path
        }
      }
    }
  }
}
