local LrApplication = import 'LrApplication'
local LrTasks = import 'LrTasks'
local LrHttp = import 'LrHttp'
local LrView = import 'LrView'
local LrDialogs = import 'LrDialogs'

local exportFilterProvider = {}

exportFilterProvider.exportPresetFields = {
    { key = 'enabled', default = true }
}

function exportFilterProvider.sectionForFilterInDialog( f, propertyTable )
    return {
        title = "Social Media Central",
        f:row {
            f:static_text {
                title = "Images and metadata will be sent to the SMC app after export."
            }
        }
    }
end

function exportFilterProvider.postProcessRenderedPhotos(functionContext, filterContext)
    -- Wrap the entire process in an async task so we don't block Lightroom
    LrTasks.startAsyncTask(function()
        
        -- Wrap in a protected call (try/catch) so it CANNOT fail silently
        local status, err = pcall(function()
            local imagePaths = {}
            local metadata = {}
            local firstPhotoProcessed = false

            local renditionOptions = {
                plugin = _PLUGIN,
                renditionsToSatisfy = filterContext.renditionsToSatisfy,
            }

            for sourceRendition, renditionToSatisfy in filterContext:renditions(renditionOptions) do
                -- Wait for Lightroom to finish applying your preset (watermark, resize)
                local success, pathOrMessage = sourceRendition:waitForRender()
                
                if success then
                    table.insert(imagePaths, pathOrMessage)

                    if not firstPhotoProcessed then
                        local photo = sourceRendition.photo
                        if photo then
                            local function getMeta(key)
                                local s, val = pcall(function() return photo:getFormattedMetadata(key) end)
                                if s and val then return tostring(val) else return "" end
                            end
                            
                            metadata = {
                                title = getMeta('title'),
                                caption = getMeta('caption'),
                                keywords = getMeta('keywordTagsForExport'),
                                location = getMeta('location'),
                                camera = getMeta('cameraModel'),
                                lens = getMeta('lens'),
                                aperture = getMeta('aperture'),
                                iso = getMeta('isoSpeedRating')
                            }
                            firstPhotoProcessed = true
                        end
                    end
                end

                -- STRICT SDK REQUIREMENT: Tell Lightroom we finished inspecting this file
                if renditionToSatisfy then
                    renditionToSatisfy:renditionIsDone(success, pathOrMessage)
                end
            end

            -- Now send the data
            if #imagePaths > 0 then
                local function escapeJson(str)
                    if str == nil then return "" end
                    str = tostring(str)
                    str = string.gsub(str, "\\", "\\\\")
                    str = string.gsub(str, '"', '\\"')
                    str = string.gsub(str, "\n", "\\n")
                    str = string.gsub(str, "\r", "\\r")
                    return str
                end

                local keywordsJson = "[]"
                if metadata.keywords and metadata.keywords ~= "" then
                    local kwArray = {}
                    for kw in string.gmatch(metadata.keywords, "[^,]+") do
                        kw = string.match(kw, "^%s*(.-)%s*$")
                        table.insert(kwArray, '"' .. escapeJson(kw) .. '"')
                    end
                    keywordsJson = "[" .. table.concat(kwArray, ", ") .. "]"
                end

                local pathsJsonArray = {}
                for _, p in ipairs(imagePaths) do
                    table.insert(pathsJsonArray, '"' .. escapeJson(p) .. '"')
                end
                local pathsJson = "[" .. table.concat(pathsJsonArray, ", ") .. "]"

                -- Build JSON via pure concatenation so '%' symbols in EXIF or Paths don't crash the script
                local payload = '{' ..
                    '"imagePaths": ' .. pathsJson .. ',' ..
                    '"metadata": {' ..
                        '"title": "' .. escapeJson(metadata.title) .. '",' ..
                        '"caption": "' .. escapeJson(metadata.caption) .. '",' ..
                        '"keywords": ' .. keywordsJson .. ',' ..
                        '"location": "' .. escapeJson(metadata.location) .. '",' ..
                        '"camera": "' .. escapeJson(metadata.camera) .. '",' ..
                        '"lens": "' .. escapeJson(metadata.lens) .. '",' ..
                        '"aperture": "' .. escapeJson(metadata.aperture) .. '",' ..
                        '"iso": "' .. escapeJson(metadata.iso) .. '"' ..
                    '}' ..
                '}'

                local headers = {
                    { field = 'Content-Type', value = 'application/json' }
                }

                local response, responseHeaders = LrHttp.post('http://127.0.0.1:49152/lightroom-export', payload, headers)
                
                if response then
                    LrDialogs.message("SMC Server Response", tostring(response), "info")
                else
                    LrDialogs.message("Connection Failed", "Could not reach Social Media Central. Is the app open?", "critical")
                end
            else
                LrDialogs.message("Export Warning", "No images were successfully generated by Lightroom.", "warning")
            end
        end)

        -- If ANY error happened in the block above, pop up a crash dump
        if not status then
            LrDialogs.message("Lua Crash Dump", tostring(err), "critical")
        end
    end)
end

return exportFilterProvider
